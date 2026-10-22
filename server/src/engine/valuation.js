/**
 * 大模型估值与性价比（PRD 4.2 模块 B）
 * 输入：结构化资产字段 + 同游戏本平台成交样本 + 聚合在售同款挂牌价分布
 * 输出：估值区间/中点/性价比分/置信度/依据因子
 * 置信度：可比样本 ≥20 高、5-19 中、<5 低；低置信不参与性价比排序
 * 无 LLM Key 或调用失败 → 规则兜底（样本中位数/挂牌价分位数）
 */
import { db, parseJSON } from '../db.js';
import { chat, parseLLMJson, llmEnabled } from '../llm.js';

const DAY = 86_400_000;

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round((s[lo] + (s[hi] - s[lo]) * (pos - lo)) * 100) / 100;
}
const roundY = v => Math.round(v);

/** 收集估值样本：同游戏成交单（权重高）+ 聚合在售挂牌价分布 */
export function collectSamples(gameId) {
  const deals = db.prepare(`
    SELECT price FROM self_orders WHERE game_id=? AND status='completed'
    ORDER BY completed_at DESC LIMIT 60
  `).all(gameId).map(r => r.price);
  const listings = db.prepare(`
    SELECT price FROM goods WHERE game_id=? AND status='on' ORDER BY last_seen DESC LIMIT 300
  `).all(gameId).map(r => r.price);
  return { deals, listings };
}

function confidenceOf(n) {
  return n >= 20 ? 'high' : n >= 5 ? 'mid' : 'low';
}

/** 规则兜底估值 */
function ruleValue({ deals, listings }, price) {
  const sampleCount = deals.length + listings.length;
  let mid = 0;
  if (deals.length >= 3) mid = median(deals);
  else if (listings.length >= 5) mid = quantile(listings, 0.5);
  if (!mid) mid = price; // 完全无样本：以挂牌价为中心，低置信
  const spreadBase = listings.length >= 5 ? (quantile(listings, 0.85) - quantile(listings, 0.15)) / 2 : mid * 0.18;
  const low = Math.max(1, roundY(mid - Math.max(spreadBase, mid * 0.12)));
  const high = roundY(mid + Math.max(spreadBase, mid * 0.12));
  const factors = [];
  if (deals.length) factors.push({ name: '本平台成交样本', desc: `同游戏近期 ${deals.length} 笔完成订单，中位成交价 ¥${roundY(median(deals))}` });
  if (listings.length) factors.push({ name: '聚合挂牌价分布', desc: `同款在售 ${listings.length} 件，P15-P85 区间 ¥${quantile(listings, 0.15)}–¥${quantile(listings, 0.85)}` });
  factors.push({ name: '资产结构化字段', desc: '段位/等级、皮肤数、英雄/角色数与关键资产清单参与定价权重' });
  return { low, high, mid: roundY(mid), factors, sampleCount, note: deals.length ? '基于本平台真实成交样本估算' : (listings.length ? '成交样本不足，参考聚合平台挂牌价分布估算' : '样本不足，估值仅供参考') };
}

/** 对单个 Listing 估值并落库（重估频控：每日 1 次） */
export async function valueListing(listingId, { force = false } = {}) {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
  if (!l) return null;
  const last = db.prepare('SELECT valued_at FROM valuations WHERE listing_id=? ORDER BY valued_at DESC LIMIT 1').get(listingId);
  if (!force && last && Date.now() - last.valued_at < DAY) return db.prepare('SELECT * FROM valuations WHERE listing_id=? ORDER BY valued_at DESC LIMIT 1').get(listingId);

  const game = db.prepare('SELECT name FROM games WHERE id=?').get(l.game_id);
  const samples = collectSamples(l.game_id);
  const assets = parseJSON(l.assets_json, {});
  const rule = ruleValue(samples, l.price);

  let result = rule;
  let source = 'rule';
  if (llmEnabled) {
    const prompt = `你是游戏账号交易估值模型。请基于以下数据给出账号估值区间（人民币元），只输出 JSON：{"low":number,"high":number,"mid":number,"factors":[{"name":string,"desc":string}],"note":string}。
要求：factors 列 3-5 个主要影响因子；不得引入未验证外部信息；区间取整到元。
【商品】游戏：${game?.name || l.game_id}；区服/渠道：${l.server_name}/${l.channel}；挂牌价：¥${l.price}
【结构化资产】${JSON.stringify(assets)}
【描述】${(l.description || '').slice(0, 200)}
【本平台同游戏成交样本】${samples.deals.length} 笔：${samples.deals.slice(0, 20).join(', ') || '无'}
【聚合平台同款挂牌价】${samples.listings.length} 件，P15=${quantile(samples.listings, 0.15)} 中位=${quantile(samples.listings, 0.5)} P85=${quantile(samples.listings, 0.85)}`;
    const out = await chat([{ role: 'user', content: prompt }], { jsonMode: true, maxTokens: 800 });
    const j = parseLLMJson(out);
    if (j && Number.isFinite(+j.low) && Number.isFinite(+j.high) && Number.isFinite(+j.mid) && +j.mid > 0) {
      result = {
        low: roundY(+j.low), high: roundY(+j.high), mid: roundY(+j.mid),
        factors: Array.isArray(j.factors) ? j.factors.slice(0, 5) : rule.factors,
        sampleCount: rule.sampleCount, note: j.note || rule.note,
      };
      source = 'llm';
    }
  }

  const score = Math.min(100, Math.round((result.mid / l.price) * 70));
  const confidence = confidenceOf(result.sampleCount);
  const now = Date.now();
  db.prepare(`INSERT INTO valuations (listing_id, low, high, mid, score, confidence, basis_json, note, sample_count, source, valued_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(listingId, result.low, result.high, result.mid, score, confidence,
      JSON.stringify(result.factors), result.note, result.sampleCount, source, now);
  return db.prepare('SELECT * FROM valuations WHERE id=?').get(db.prepare('SELECT MAX(id) AS m FROM valuations WHERE listing_id=?').get(listingId).m);
}

/** 最新估值（列表/详情展示用） */
export function latestValuation(listingId) {
  const v = db.prepare('SELECT * FROM valuations WHERE listing_id=? ORDER BY valued_at DESC LIMIT 1').get(listingId);
  if (!v) return null;
  return {
    low: v.low, high: v.high, mid: v.mid, score: v.score,
    confidence: v.confidence, basis: parseJSON(v.basis_json, []),
    note: v.note, sample_count: v.sample_count, source: v.source, valued_at: v.valued_at,
  };
}

/** 详情页「解读」：大模型 ≤200 字自然语言说明，兜底模板 */
export async function explainListing(listingId) {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
  const v = latestValuation(listingId);
  if (!l || !v) return { text: '暂无估值数据。', source: 'none' };
  const game = db.prepare('SELECT name FROM games WHERE id=?').get(l.game_id);
  const assets = parseJSON(l.assets_json, {});
  if (llmEnabled) {
    const out = await chat([
      { role: 'system', content: '你是游戏账号估值解读助手。仅基于给定数据用中文写不超过 200 字的通俗解读，不构成价格承诺，不引入外部信息。' },
      { role: 'user', content: `商品：${game?.name} ${l.server_name}，资产 ${JSON.stringify(assets)}，挂牌 ¥${l.price}，估值区间 ¥${v.low}-¥${v.high}（中点 ¥${v.mid}），性价比分 ${v.score}，置信度 ${v.confidence}，依据：${v.basis.map(b => b.name).join('、')}。` },
    ], { maxTokens: 400 });
    if (out) return { text: out.trim().slice(0, 300), source: 'llm' };
  }
  const pct = Math.round((v.mid / l.price - 1) * 100);
  const cmp = pct >= 0 ? `挂牌价低于估值中点约 ${pct}%，性价比较高` : `挂牌价高于估值中点约 ${-pct}%，可关注同款低价`;
  return {
    text: `该 ${game?.name || ''} 账号基于 ${v.sample_count} 个可比样本估值 ¥${v.low}-¥${v.high}（置信度${v.confidence === 'high' ? '高' : v.confidence === 'mid' ? '中' : '低'}），${cmp}。主要依据：${v.basis.slice(0, 3).map(b => b.name).join('、')}。估值为模型参考，不构成价格承诺。`,
    source: 'rule',
  };
}

/** 同游戏新增成交后触发其他在售 Listing 重估（每日 1 次频控内置于 valueListing） */
export async function revalueGame(gameId) {
  const rows = db.prepare("SELECT id FROM listings WHERE game_id=? AND status='on' ORDER BY listed_at DESC LIMIT 50").all(gameId);
  for (const r of rows) {
    try { await valueListing(r.id); } catch (e) { console.warn('[valuation] 重估失败', r.id, e.message); }
  }
}
