/**
 * 5173 真实采集适配器
 *
 * 采集方式：先用 withHumanPcPage 打开搜索页预热建立会话 cookie，
 * 然后在页面 JS 上下文内直接 fetch 商品列表接口（自动携带 cookie）：
 *   GET https://s.5173.com/g/accounts?page=N&page_size=20&sort=1&...&game_id={id}
 * 实测确认：
 *   - sort=1 即按发布时间倒序（create_time 最新在前）
 *   - page_size=20，page 从 1 开始递增翻页
 *   - 纯 HTTP 直连会超时/返回异常，必须走浏览器会话内 fetch
 *
 * 商品唯一 ID 用 goods_no（纯数字，如 1412838）。
 * 详情页直达：https://s.5173.com/#/accountDetail?goods_no={goods_no}
 *
 * 每页 20 条。单轮每游戏最多抓 100 条最新发布（5 页）；
 * 整页商品均已收录则增量早退，稳态下通常只请求第 1 页。
 */
import { BaseAdapter } from './base.js';
import { withHumanPcPage } from '../collector.js';
import { dbPrepare } from './dbproxy.js';

const PAGE_SIZE = 20;
const MAX_PER_GAME = 100;
const MAX_PAGES = Math.ceil(MAX_PER_GAME / PAGE_SIZE);
const PRICE_MAX = 1000000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 游戏之间停顿 3~6s 随机抖动
const gameGap = () => 3000 + Math.floor(Math.random() * 3000);
// 翻页停顿 2~3.8s 随机
const pageGap = () => 2000 + Math.floor(Math.random() * 1800);

// 页面内执行的列表请求；必须是无外部依赖的纯函数（URL 需内联）
// kind: 'http' = 非 200/非 JSON（可能风控）；'timeout'/'net' = 网络抖动
async function fetchAccounts(gameId, pg) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const u = `https://s.5173.com/g/accounts?page=${pg}&page_size=20&total=0&account_type=1` +
      `&transaction_cancel=0&complaint_rate=0&sort=1&transaction_duration=0&click_conversion_rate=0` +
      `&min_price=0&max_price=0&business_type=0&sub_title=&attrValList=[]&identity=0&game_id=${gameId}`;
    const r = await fetch(u, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    if (r.status !== 200 || !ct.includes('json') || text.trim().startsWith('<')) {
      // challenge=返回 HTML 挑战页（风控明确信号）；5xx/其他非 200 多为网关临时错误
      return { blocked: true, kind: 'http', status: r.status, challenge: text.trim().startsWith('<') };
    }
    return { blocked: false, json: JSON.parse(text) };
  } catch (e) {
    return { blocked: true, kind: e && e.name === 'AbortError' ? 'timeout' : 'net', error: String(e && e.message || e) };
  }
}

export class S5173Adapter extends BaseAdapter {
  constructor() {
    super({
      platform: '5173',
      name: '5173',
      intervalMs: 30 * 60_000,  // 每 30 分钟一轮
      priceBias: 1.0,
      gameFilter: () => true,
      tagBias: ['可二次'],
      realMode: true,
    });
  }

  async fetchReal(games, now) {
    const allItems = [];
    // 已收录商品 id（含在售/下架），用于"整页重复即停止"的增量早退
    const knownIds = new Set(
      dbPrepare('SELECT platform_item_id FROM goods WHERE platform=?').all(this.platform).map(r => r.platform_item_id)
    );

    // 长会话（游戏多）末期页面线程可能退化，每 CHUNK 款游戏重建一次预热会话
    const CHUNK = 6;
    let abortAll = false;
    for (let start = 0; start < games.length && !abortAll; start += CHUNK) {
      const chunk = games.slice(start, start + CHUNK);
      await withHumanPcPage({ url: 'https://s.5173.com/' }, async (page) => {
        for (let gi = 0; gi < chunk.length; gi++) {
          const game = chunk[gi];
          if (gi > 0) await sleep(gameGap());
          const gameId = String(game.platformGameCode);
          console.log(`[5173] 采集 ${game.name} (game_id=${gameId})`);

          let collected = 0;
          let skipGame = false;

          for (let pg = 1; pg <= MAX_PAGES; pg++) {
            if (pg > 1) await sleep(pageGap());
            let res;
            try {
              res = await page.evaluate(fetchAccounts, gameId, pg);
            } catch (e) {
              console.warn(`[5173] ${game.name} 浏览器执行异常，跳过本游戏: ${e.message}`);
              skipGame = true; break;
            }
            if (res.blocked) {
              // 首次请求异常：等 5s 重试一次（会话 cookie 可能尚未就绪）
              if (pg === 1) {
                console.warn(`[5173] ${game.name} 首次请求异常（${res.kind}），等待 5s 后重试`);
                await sleep(5000);
                try { res = await page.evaluate(fetchAccounts, gameId, pg); }
                catch (e) { console.warn(`[5173] ${game.name} 重试异常，跳过: ${e.message}`); skipGame = true; break; }
              }
              if (res.blocked) {
                if (res.kind === 'http' && (res.status === 403 || res.challenge)) {
                  // 明确风控信号（403 封禁 / HTML 挑战页）：中止本轮，避免加重封禁，不造数
                  console.warn(`[5173] ${game.name} 触发风控（status=${res.status}${res.challenge ? '，挑战页' : ''}），本轮 5173 采集提前结束（不造数）`);
                  abortAll = true;
                } else {
                  // 5xx 网关错误 / 超时 / 网络抖动：临时故障，只跳过本游戏，继续采集其余游戏
                  console.warn(`[5173] ${game.name} 请求失败（${res.kind}${res.status ? ' status=' + res.status : ''}），跳过本游戏继续其余游戏`);
                  skipGame = true;
                }
                break;
              }
            }

            const list = Array.isArray(res.json?.data?.items) ? res.json.data.items : [];
            if (!list.length) break;

            let pageKnown = 0;
            for (const p of list) {
              const item = this.mapProduct(p, game, now);
              if (!item) continue;
              if (knownIds.has(item.platform_item_id)) pageKnown++;
              else { knownIds.add(item.platform_item_id); }
              allItems.push(item);
              collected++;
              if (collected >= MAX_PER_GAME) break;
            }

            // 整页都是已收录商品 → 后续页是更旧数据，增量早退
            if (pageKnown === list.length) {
              console.log(`[5173] ${game.name} 第 ${pg} 页均为已收录，增量采集提前结束`);
              break;
            }
            if (list.length < PAGE_SIZE || collected >= MAX_PER_GAME) break;
          }

          if (abortAll) break;
          if (!skipGame) console.log(`[5173] ${game.name} 本轮新增/刷新 ${collected} 条`);
        }
      });
    }
    return allItems;
  }

  /** 将 5173 商品对象归一化为引擎标准结构；无效返回 null */
  mapProduct(p, game, now) {
    const id = p.goods_no ? String(p.goods_no) : '';
    if (!id) return null;
    const price = Number(p.price); // 元（字符串，如 "589.00"）
    if (!isFinite(price) || price <= 0 || price > PRICE_MAX) return null;

    const title = String(p.title || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!title) return null;

    const tags = ['5173'];
    const attrs = Array.isArray(p.extendAttrs)
      ? p.extendAttrs.map(a => a?.evs).filter(Boolean).flatMap(s => s.split(',')).filter(Boolean)
      : [];
    tags.push(...attrs.slice(0, 6));
    if (p.business_text) tags.push(String(p.business_text));

    // 区服：area_name + server_name（如 "QQ(苹果)" + "手Q363区"）
    const server = [p.area_name, p.server_name].filter(Boolean).join(' ').slice(0, 60);

    // 图片：screenshot 逗号分隔多图
    const images = String(p.screenshot || '').split(',').map(s => s.trim()).filter(u => /^https?:\/\//.test(u)).slice(0, 3);

    return {
      platform_item_id: id,
      game_id: game.id,
      server_name: server,
      title,
      description: String(p.goods_desc || '').replace(/\s+/g, ' ').slice(0, 800),
      price,
      original_price: price,
      tags: [...new Set(tags)].slice(0, 12),
      images,
      seller: '', // 不采集卖家信息
      publish_time: parseTime(p.create_time) || now,
      // 直达原平台商品详情页
      source_url: `https://s.5173.com/#/accountDetail?goods_no=${id}`,
    };
  }
}

// "2026-09-26 17:51:36"（北京时间 UTC+8）→ 毫秒时间戳
function parseTime(s) {
  if (!s || typeof s !== 'string') return 0;
  const t = Date.parse(s.replace(' ', 'T') + '+08:00');
  return isFinite(t) ? t : 0;
}
