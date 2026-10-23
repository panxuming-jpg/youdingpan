/**
 * 卖家资质与自营商品路由（PRD 模块 A/B 公开侧）
 * FR-A1 实名+归属凭证 | FR-A2 发布表单 | FR-A3 一键生成展示图 | FR-A4 审核上架
 * FR-B3 性价比排序列表 | FR-B4 详情估值卡
 */
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db, parseJSON, getSettingNum, sellerCreditInfo, creditGrade } from '../db.js';
import { templateFor, assetLabel, assetsZh } from '../asset_templates.js';
import { authRequired, adminRequired } from '../middleware.js';
import { maskAccount } from '../pay.js';
import { notify as notifyRef } from '../engine/auction.js';
import { valueListing, latestValuation, explainListing } from '../engine/valuation.js';
import { uploadDir } from './upload.js';

const router = Router();

// 内容风控（PRD 5.4）：站外联系方式/私下交易话术/违规代练
const FORBIDDEN_RE = /(微信|weixin|vx|VX|加我|扣扣|qq号|电话|手机号|联系方式|私下|站外|线下交易|绕过平台|代练|陪玩|出租)/i;

// 结构化资产模板与中文标签（共享模块，见 asset_templates.js）

function shapeListing(l, { withValuation = true } = {}) {
  const game = db.prepare('SELECT name FROM games WHERE id=?').get(l.game_id);
  const seller = sellerCreditInfo(l.seller_id);
  const v = withValuation ? latestValuation(l.id) : null;
  return {
    id: l.id,
    seller_id: l.seller_id,
    seller_name: seller?.seller_name || '',
    seller_credit: seller || null, // C2C 卖家信用：等级 + 支付宝/微信信用分 + 在线状态
    game_id: l.game_id,
    game_name: game?.name || '',
    server_name: l.server_name,
    channel: l.channel,
    account_mask: maskAccount(l.account_id),
    assets: parseJSON(l.assets_json, {}),
    assets_zh: assetsZh(parseJSON(l.assets_json, {}), game?.name || ''), // 中文标签版，供所有展示端使用
    images: parseJSON(l.gen_images_json, []).length ? parseJSON(l.gen_images_json, []) : parseJSON(l.raw_images_json, []),
    raw_count: parseJSON(l.raw_images_json, []).length,
    price: l.price,
    support_compensation: !!l.support_compensation,
    description: l.description,
    status: l.status,
    reject_reason: l.reject_reason || '',
    verified: (l.verified_until || 0) > Date.now(),
    listed_at: l.listed_at,
    created_at: l.created_at,
    valuation: v,
  };
}

// ---------- FR-A1 实名 + 归属凭证 ----------
router.post('/seller/realname', authRequired, (req, res) => {
  const { real_name, id_card } = req.body || {};
  if (!real_name || real_name.length < 2) return res.json({ ok: false, error: '请填写真实姓名' });
  if (!/^\d{17}[\dXx]$/.test(id_card || '')) return res.json({ ok: false, error: '身份证号格式不正确（18 位）' });
  // 演示模式：模拟人脸核验通过（真实接入：对接人脸核验服务商，PRD Q8）
  db.prepare(`UPDATE users SET real_name=?, id_card=?, face_verified=1 WHERE id=?`).run(real_name, id_card, req.user.id);
  res.json({ ok: true, data: { real_name, face_verified: true } });
});

router.get('/seller/status', authRequired, (req, res) => {
  const u = db.prepare('SELECT real_name, id_card, face_verified, seller_status, seller_reject_reason, seller_ban_until, alipay_credit_score, wechat_credit_score, credit_grade FROM users WHERE id=?').get(req.user.id);
  const proofs = db.prepare('SELECT p.*, g.name AS game_name FROM seller_proofs p LEFT JOIN games g ON g.id=p.game_id WHERE p.user_id=? ORDER BY p.id DESC').all(req.user.id)
    .map(p => ({ ...p, images: parseJSON(p.images, []), created_at: p.created_at }));
  res.json({ ok: true, data: {
    real_name: u.real_name || '', id_card_mask: u.id_card ? u.id_card.slice(0, 4) + '**********' + u.id_card.slice(-4) : '',
    face_verified: !!u.face_verified, seller_status: u.seller_status || '',
    reject_reason: u.seller_reject_reason || '', ban_until: u.seller_ban_until || 0, proofs,
    alipay_credit_score: u.alipay_credit_score || 0, wechat_credit_score: u.wechat_credit_score || 0,
    credit_grade: u.credit_grade || '',
  } });
});

// ---------- C2C 卖家信用：绑定支付宝/微信信用分（演示模式：模拟渠道授权回填） ----------
router.post('/seller/credit-bind', authRequired, (req, res) => {
  const { channel, score } = req.body || {};
  if (!['alipay', 'wechat'].includes(channel)) return res.json({ ok: false, error: '渠道须为 alipay（芝麻信用）或 wechat（微信支付分）' });
  const s = Math.round(Number(score));
  if (!Number.isFinite(s) || s < 350 || s > 950) return res.json({ ok: false, error: '信用分须在 350-950 之间' });
  const u = db.prepare('SELECT alipay_credit_score, wechat_credit_score FROM users WHERE id=?').get(req.user.id);
  const alipay = channel === 'alipay' ? s : (u.alipay_credit_score || 0);
  const wechat = channel === 'wechat' ? s : (u.wechat_credit_score || 0);
  const grade = creditGrade(alipay, wechat);
  const col = channel === 'alipay' ? 'alipay_credit_score' : 'wechat_credit_score';
  db.prepare(`UPDATE users SET ${col}=?, credit_grade=? WHERE id=?`).run(s, grade, req.user.id);
  res.json({ ok: true, data: { channel, score: s, credit_grade: grade, alipay_credit_score: alipay, wechat_credit_score: wechat } });
});

router.post('/seller/proof', authRequired, (req, res) => {
  const { game_id, type, images } = req.body || {};
  if (!game_id || !type || !Array.isArray(images) || !images.length) return res.json({ ok: false, error: '请选择游戏、凭证类型并上传截图' });
  const TYPES = ['register_page', 'first_bill', 'realname_page', 'device_shot'];
  if (!TYPES.includes(type)) return res.json({ ok: false, error: '凭证类型不合法' });
  if (!db.prepare('SELECT id FROM games WHERE id=?').get(game_id)) return res.json({ ok: false, error: '游戏不存在' });
  const now = Date.now();
  db.prepare('INSERT INTO seller_proofs (user_id, game_id, type, images, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, game_id, type, JSON.stringify(images), 'pending', now, now);
  db.prepare(`UPDATE users SET seller_status='pending', seller_reject_reason='' WHERE id=? AND seller_status!='approved'`).run(req.user.id);
  res.json({ ok: true, data: { status: 'pending' } });
});

// 游戏资产模板 + 区服选项（发布表单用）
router.get('/seller/templates', (_req, res) => {
  const games = db.prepare('SELECT id, name FROM games WHERE status=1 ORDER BY sort_order').all();
  const servers = db.prepare('SELECT game_id, name, type FROM game_servers').all();
  res.json({ ok: true, data: games.map(g => ({
    ...g,
    servers: servers.filter(s => s.game_id === g.id),
    asset_template: templateFor(g.name),
  })) });
});

// ---------- FR-A2 发布 / 编辑 ----------
router.post('/listings', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.seller_status !== 'approved') return res.json({ ok: false, error: '请先完成实名认证与账号归属凭证审核（卖家资质）' });
  if ((u.seller_ban_until || 0) > Date.now()) return res.json({ ok: false, error: `因多次审核驳回，发布入口暂停至 ${new Date(u.seller_ban_until).toLocaleString('zh-CN')}` });
  const { game_id, server_name, channel, account_id, assets, raw_images, price, support_compensation, description } = req.body || {};
  const g = db.prepare('SELECT name FROM games WHERE id=?').get(game_id);
  if (!g) return res.json({ ok: false, error: '请选择游戏' });
  if (!server_name || !account_id) return res.json({ ok: false, error: '区服与账号标识为必填项' });
  if (!assets || typeof assets !== 'object' || !Object.keys(assets).length) return res.json({ ok: false, error: '请填写结构化资产字段' });
  if (!Array.isArray(raw_images) || raw_images.length < 3 || raw_images.length > 15) return res.json({ ok: false, error: '原始截图须 3-15 张' });
  const p = Number(price);
  if (!Number.isFinite(p) || p < 1) return res.json({ ok: false, error: '售价须 ≥ 1 元' });
  const desc = String(description || '').slice(0, 500);
  if (FORBIDDEN_RE.test(desc) || FORBIDDEN_RE.test(String(account_id))) return res.json({ ok: false, error: '描述/账号标识含站外联系方式或违规内容，请修改后提交（PRD 5.4）' });
  const now = Date.now();
  const r = db.prepare(`INSERT INTO listings (seller_id, game_id, server_name, channel, account_id, assets_json, raw_images_json, gen_images_json,
    price, support_compensation, description, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`)
    .run(req.user.id, game_id, server_name, channel || '', account_id, JSON.stringify(assets), JSON.stringify(raw_images), '[]',
      Math.round(p * 100) / 100, support_compensation === false ? 0 : 1, desc, now, now);
  res.json({ ok: true, data: { id: Number(r.lastInsertRowid) } });
});

router.get('/listings/mine', authRequired, (req, res) => {
  const rows = db.prepare("SELECT * FROM listings WHERE seller_id=? ORDER BY id DESC").all(req.user.id);
  res.json({ ok: true, data: rows.map(l => shapeListing(l)) });
});

router.put('/listings/:id', authRequired, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND seller_id=?').get(req.params.id, req.user.id);
  if (!l) return res.json({ ok: false, error: '商品不存在或无权限' });
  if (l.status === 'locked' || l.status === 'sold') return res.json({ ok: false, error: '锁定/已售出期间不可修改' });
  const { price, description, assets, support_compensation } = req.body || {};
  const now = Date.now();
  let priceChanged = false;
  if (price !== undefined) {
    const p = Number(price);
    if (!Number.isFinite(p) || p < 1) return res.json({ ok: false, error: '售价须 ≥ 1 元' });
    priceChanged = Math.abs(p - l.price) > 0.001;
    db.prepare('UPDATE listings SET price=? WHERE id=?').run(Math.round(p * 100) / 100, l.id);
  }
  if (description !== undefined) {
    const desc = String(description || '').slice(0, 500);
    if (FORBIDDEN_RE.test(desc)) return res.json({ ok: false, error: '描述含站外联系方式或违规内容' });
    db.prepare('UPDATE listings SET description=? WHERE id=?').run(desc, l.id);
  }
  if (assets && typeof assets === 'object') db.prepare('UPDATE listings SET assets_json=? WHERE id=?').run(JSON.stringify(assets), l.id);
  if (support_compensation !== undefined) db.prepare('UPDATE listings SET support_compensation=? WHERE id=?').run(support_compensation ? 1 : 0, l.id);
  // 驳回后修改重提
  if (l.status === 'rejected') db.prepare("UPDATE listings SET status='pending', reject_reason='', updated_at=? WHERE id=?").run(now, l.id);
  else db.prepare('UPDATE listings SET updated_at=? WHERE id=?').run(now, l.id);
  if (priceChanged && l.status === 'on') valueListing(l.id, { force: true }).catch(() => {}); // 改价触发重估
  res.json({ ok: true, data: shapeListing(db.prepare('SELECT * FROM listings WHERE id=?').get(l.id)) });
});

router.post('/listings/:id/offline', authRequired, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND seller_id=?').get(req.params.id, req.user.id);
  if (!l) return res.json({ ok: false, error: '商品不存在或无权限' });
  if (l.status === 'locked') return res.json({ ok: false, error: '有进行中订单，锁定期间不可下架' });
  if (!['on', 'review'].includes(l.status)) return res.json({ ok: false, error: '当前状态不可下架' });
  db.prepare(`UPDATE listings SET status='offline', updated_at=? WHERE id=?`).run(Date.now(), l.id);
  res.json({ ok: true });
});

// 卖家「仅用原图」：清除生成图组
router.post('/listings/:id/use-raw', authRequired, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND seller_id=?').get(req.params.id, req.user.id);
  if (!l) return res.json({ ok: false, error: '商品不存在或无权限' });
  db.prepare(`UPDATE listings SET gen_images_json='[]', updated_at=? WHERE id=?`).run(Date.now(), l.id);
  res.json({ ok: true, data: shapeListing(db.prepare('SELECT * FROM listings WHERE id=?').get(l.id)) });
});

// ---------- FR-A3 一键生成标准化展示图（服务端 SVG 合成 4 张） ----------
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function svgShot({ gameLine, headline, rows = [], big = [], no }) {
  const attrCells = big.map(([label, value]) => {
    const w = 680 / Math.max(big.length, 1);
    const i = big.findIndex(b => b[0] === label);
    return `<g transform="translate(${20 + i * w},0)"><rect width="${w - 4}" height="86" rx="10" fill="#ffffff"/><text x="${(w - 4) / 2}" y="36" text-anchor="middle" font-size="26" font-weight="700" fill="#ff2c3c">${esc(value)}</text><text x="${(w - 4) / 2}" y="64" text-anchor="middle" font-size="15" fill="#5a5f73">${esc(label)}</text></g>`;
  }).join('');
  const rowLines = rows.map(([k, v], idx) =>
    `<text x="28" y="${140 + idx * 34}" font-size="17" fill="#e8e9f0">${esc(k)}：<tspan fill="#fff" font-weight="600">${esc(v)}</tspan></text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480" font-family="'PingFang SC','Microsoft YaHei',sans-serif">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2440"/><stop offset="1" stop-color="#4a2c3f"/></linearGradient></defs>
  <rect width="720" height="480" fill="url(#bg)"/>
  <text x="20" y="34" font-size="14" fill="#ffffff" opacity="0.85">${esc(gameLine)}</text>
  <text x="20" y="62" font-size="22" font-weight="700" fill="#ffffff">${esc(headline)}</text>
  <g transform="translate(20,84)">${attrCells}</g>
  ${rowLines}
  <g transform="translate(0,440)"><rect width="720" height="40" fill="#1f2233"/>
  <text x="20" y="26" font-size="13" fill="#9aa0b4">游盯盘 NO.${esc(no)} · 已验归属</text>
  <text x="700" y="26" text-anchor="end" font-size="13" fill="#ff6a00">交易请认准游盯盘担保流程</text></g>
  <text x="360" y="250" font-size="46" fill="#ffffff" opacity="0.07" text-anchor="middle" transform="rotate(-14 360 250)">游盯盘 NO.${esc(no)}</text>
</svg>`;
}

router.post('/listings/:id/generate-images', authRequired, async (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND seller_id=?').get(req.params.id, req.user.id);
  if (!l) return res.json({ ok: false, error: '商品不存在或无权限' });
  const game = db.prepare('SELECT name FROM games WHERE id=?').get(l.game_id);
  const assets = parseJSON(l.assets_json, {});
  const tpl = templateFor(game?.name || '');
  const gameLine = `${game?.name || ''} · ${l.server_name}${l.channel ? ' · ' + l.channel : ''}`;
  const keyAssets = String(assets.key_assets || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  const headline = `${Object.entries(assets).filter(([k]) => k !== 'key_assets').slice(0, 2).map(([, v]) => v).join(' · ')} 账号直售`;
  const big = tpl.filter(t => t.type !== 'tags').slice(0, 4).map(t => [t.label, String(assets[t.key] ?? '-')]);
  const ts = Date.now();
  const shots = [
    svgShot({ gameLine, headline, big, no: l.id }),
    svgShot({ gameLine, headline: '资产总览', rows: Object.entries(assets).map(([k, v]) => [assetLabel(k, game?.name || ''), String(v)]), no: l.id }),
    svgShot({ gameLine, headline: '关键资产', rows: keyAssets.length ? keyAssets.map((a, i) => [`#${i + 1}`, a]) : [['关键资产', '无']], no: l.id }),
    svgShot({ gameLine, headline: '段位 / 等级页', big: big.slice(0, 2), rows: [['区服', l.server_name], ['渠道', l.channel || '官服']], no: l.id }),
  ];
  const genDir = path.join(uploadDir, 'gen');
  if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
  const urls = shots.map((svg, i) => {
    const fname = `listing_${l.id}_${i + 1}_${ts}.svg`;
    fs.writeFileSync(path.join(genDir, fname), svg, 'utf8');
    return `/uploads/gen/${fname}`;
  });
  db.prepare(`UPDATE listings SET gen_images_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(urls), Date.now(), l.id);
  res.json({ ok: true, data: { images: urls } });
});

// ---------- FR-B3 公开列表（性价比排序档） ----------
router.get('/self/listings', (req, res) => {
  const { game_id, price_min, price_max, sort, page = 1 } = req.query;
  const cond = ["l.status IN ('on','locked')"];
  const args = [];
  if (game_id) { cond.push('l.game_id=?'); args.push(Number(game_id)); }
  if (price_min) { cond.push('l.price >= ?'); args.push(Number(price_min)); }
  if (price_max) { cond.push('l.price <= ?'); args.push(Number(price_max)); }
  const where = 'WHERE ' + cond.join(' AND ');
  const order = sort === 'value'
    ? `ORDER BY CASE WHEN v.confidence IN ('high','mid') THEN 0 ELSE 1 END, COALESCE(v.score,0) DESC, l.listed_at DESC`
    : sort === 'price_asc' ? 'ORDER BY l.price ASC, l.listed_at DESC'
    : 'ORDER BY l.listed_at DESC';
  const rows = db.prepare(`
    SELECT l.*, v.score AS v_score, v.confidence AS v_conf, v.low AS v_low, v.high AS v_high, v.mid AS v_mid, v.valued_at AS v_at
    FROM listings l
    LEFT JOIN valuations v ON v.listing_id=l.id AND v.id=(SELECT MAX(id) FROM valuations WHERE listing_id=l.id)
    ${where} ${order}
  `).all(...args);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM listings l ${where}`).get(...args).c;
  res.json({ ok: true, data: { total, list: rows.map(l => {
    const s = shapeListing(l, { withValuation: false });
    s.valuation = l.v_at ? { low: l.v_low, high: l.v_high, mid: l.v_mid, score: l.v_score, confidence: l.v_conf, valued_at: l.v_at } : null;
    return s;
  }) } });
});

// ---------- FR-B4 详情（估值卡 + 解读） ----------
router.get('/self/listings/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ ok: false, error: '商品不存在' });
  const data = shapeListing(l);
  data.raw_images = parseJSON(l.raw_images_json, []);
  data.can_view_raw = req.user && (req.user.id === l.seller_id || req.user.is_admin);
  if (data.can_view_raw) data.account_id = l.account_id;
  // 在售/锁定商品的完整详情需登录（与聚合侧一致）
  if (!req.user && ['on', 'locked'].includes(l.status)) { /* 列表级信息已足够，账号标识保持脱敏 */ }
  const appraisals = db.prepare(`SELECT id, status, conclusion, report_json, created_at, reported_at FROM appraisals
    WHERE listing_id=? AND status='reported' ORDER BY reported_at DESC LIMIT 3`).all(l.id)
    .map(a => ({ ...a, report: parseJSON(a.report_json, null), conclusion_label: { match: '相符', partial: '部分不符', mismatch: '不符', incapable: '无法鉴定' }[a.conclusion] || a.conclusion }));
  data.appraisals = appraisals;
  res.json({ ok: true, data });
});

router.post('/self/listings/:id/explain', (req, res) => {
  explainListing(Number(req.params.id)).then(r => res.json({ ok: true, data: r })).catch(() => res.json({ ok: false, error: '解读生成失败' }));
});

// 下单前申请鉴号（FR-C2 触发①）：返回鉴号费，实际下单走 /appraisals/pre
router.get('/self/fees', (_req, res) => {
  res.json({ ok: true, data: {
    compensation_fee: getSettingNum('compensation_fee', 100),
    appraisal_fee: getSettingNum('appraisal_fee', 50),
    commission_rate: getSettingNum('self_commission_rate', 0.06),
    pay_timeout_min: getSettingNum('self_pay_timeout_min', 30),
    auto_confirm_days: getSettingNum('self_auto_confirm_days', 7),
    guarantee_days: getSettingNum('compensation_days', 180),
  } });
});

// ---------- FR-A4 运营审核 ----------
router.get('/admin/listings', authRequired, adminRequired, (req, res) => {
  const { status } = req.query;
  const rows = db.prepare(`SELECT l.*, u.nickname AS seller_nick FROM listings l LEFT JOIN users u ON u.id=l.seller_id
    ${status ? 'WHERE l.status=?' : ''} ORDER BY l.id DESC LIMIT 200`).all(...(status ? [status] : []));
  res.json({ ok: true, data: rows.map(l => ({ ...shapeListing(l), seller_nick: l.seller_nick })) });
});

router.post('/admin/listings/:id/review', authRequired, adminRequired, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.json({ ok: false, error: '商品不存在' });
  if (!['pending', 'review'].includes(l.status)) return res.json({ ok: false, error: '当前状态不可审核' });
  const { action, reason } = req.body || {};
  const now = Date.now();
  if (action === 'approve') {
    db.prepare(`UPDATE listings SET status='on', reject_reason='', listed_at=?, updated_at=? WHERE id=?`).run(now, now, l.id);
    notifySeller(l.seller_id, '商品审核通过', `您的商品 #${l.id} 已通过审核上架，估值已自动生成。`);
    valueListing(l.id, { force: true }).catch(() => {}); // 首次估值
  } else if (action === 'reject') {
    if (!reason) return res.json({ ok: false, error: '驳回必须附原因' });
    db.prepare(`UPDATE listings SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`).run(reason, now, l.id);
    notifySeller(l.seller_id, '商品审核驳回', `您的商品 #${l.id} 审核未通过：${reason}。可修改后重新提交。`);
    // 24h 内驳回 ≥3 次 → 暂停发布入口 72h
    const recent = db.prepare(`SELECT COUNT(*) AS c FROM listings WHERE seller_id=? AND status='rejected' AND updated_at >= ?`).get(l.seller_id, now - 86_400_000).c;
    if (recent >= 3) {
      db.prepare('UPDATE users SET seller_ban_until=? WHERE id=?').run(now + 72 * 3_600_000, l.seller_id);
      notifySeller(l.seller_id, '发布入口暂停', `因 24 小时内审核驳回达 ${recent} 次，您的发布入口已暂停 72 小时（防恶意刷审）。`);
    }
  } else {
    return res.json({ ok: false, error: 'action 须为 approve/reject' });
  }
  res.json({ ok: true });
});

function notifySeller(userId, title, content) {
  notifyRef(userId, 'system', title, content);
}

// ---------- 凭证审核（FR-A1 人工审核为主） ----------
router.get('/admin/proofs', authRequired, adminRequired, (_req, res) => {
  const rows = db.prepare(`SELECT p.*, u.nickname, u.phone, u.real_name, g.name AS game_name FROM seller_proofs p
    LEFT JOIN users u ON u.id=p.user_id LEFT JOIN games g ON g.id=p.game_id
    WHERE p.status='pending' ORDER BY p.id DESC LIMIT 200`).all();
  res.json({ ok: true, data: rows.map(p => ({ ...p, images: parseJSON(p.images, []) })) });
});

router.post('/admin/proofs/:id/review', authRequired, adminRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM seller_proofs WHERE id=?').get(req.params.id);
  if (!p) return res.json({ ok: false, error: '凭证不存在' });
  const { action, reason } = req.body || {};
  const now = Date.now();
  if (action === 'approve') {
    db.prepare(`UPDATE seller_proofs SET status='approved', updated_at=? WHERE id=?`).run(now, p.id);
    db.prepare(`UPDATE users SET seller_status='approved', seller_reject_reason='' WHERE id=?`).run(p.user_id);
    notifyRef(p.user_id, 'system', '卖家资质审核通过', '您的账号归属凭证已审核通过，已获得卖家资质，可上传账号商品。');
  } else if (action === 'reject') {
    db.prepare(`UPDATE seller_proofs SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`).run(reason || '凭证与商品填报信息冲突', now, p.id);
    const anyApproved = db.prepare("SELECT COUNT(*) AS c FROM seller_proofs WHERE user_id=? AND status='approved'").get(p.user_id).c;
    if (!anyApproved) {
      db.prepare(`UPDATE users SET seller_status='rejected', seller_reject_reason=? WHERE id=?`).run(reason || '凭证不符合要求', p.user_id);
    }
    notifyRef(p.user_id, 'system', '凭证审核驳回', `凭证审核未通过：${reason || '不符合要求'}。可重新提交，不限次数。`);
  } else {
    return res.json({ ok: false, error: 'action 须为 approve/reject' });
  }
  res.json({ ok: true });
});

export default router;
