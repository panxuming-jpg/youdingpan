/**
 * 螃蟹账号真实采集适配器
 *
 * 背景：PC 端商品接口 api-pc.pxb7.com/api/bff/web/product/search/productPage 有阿里云
 *      FeiLin 人机验证（headless/headful 均会被弹滑块，返回挑战 HTML）。
 *
 * 拟人采集方案（实测可过）：
 *  1. 用移动 UA 打开 H5 站 https://m1.pxb7.com/，先预热 8~12s 并做触摸式分段滚动，
 *     让设备指纹/无感验证 SDK 初始化、下发信任 cookie；
 *  2. 在同一页面 JS 上下文内 fetch H5 商品接口（自动携带 cookie/指纹，与真实 App 完全一致）：
 *     POST https://api-m.pxb7.com/api/search/h5/product/selectSearchPageList
 *  3. 默认返回即按上架时间 createTime 倒序（最新在前）；价格单位为分（/100）。
 *  4. 单游戏最新 100 条，翻到"整页都已收录"即提前停止（增量、最小化请求）；
 *     一旦返回挑战 HTML 立即终止本轮，绝不造数（realMode 回放池内真实商品）。
 */
import { BaseAdapter } from './base.js';
import { withHumanMobilePage } from '../collector.js';
import { dbPrepare } from './dbproxy.js';

const PAGE_SIZE = 20;
const MAX_PER_GAME = 100;
const PRICE_MAX = 100000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pageGap = () => 3000 + Math.floor(Math.random() * 3000); // 游戏间 3~6s 随机
const pageGapInner = () => 2000 + Math.floor(Math.random() * 1800); // 翻页间 2~3.8s 随机

// 在 H5 页面上下文内执行；必须是无外部依赖的纯函数（URL 需内联，不能引用 Node 模块变量）
// kind: 'challenge' = 风控挑战 HTML；'timeout'/'net' = 网络抖动（可跳过该游戏继续）
async function h5Fetch(payload) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // 单次请求 20s 兜底，避免挂死拖垮整轮
    const r = await fetch('https://api-m.pxb7.com/api/search/h5/product/selectSearchPageList', {
      method: 'POST',
      headers: { 'content-type': 'application/json', clientType: '2', h5ClientType: '11' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    if (!ct.includes('json') || text.trim().startsWith('<')) {
      return { blocked: true, kind: 'challenge', status: r.status };
    }
    return { blocked: false, json: JSON.parse(text) };
  } catch (e) {
    return { blocked: true, kind: e && e.name === 'AbortError' ? 'timeout' : 'net', error: String(e && e.message || e) };
  }
}

export class PangxieAdapter extends BaseAdapter {
  constructor() {
    super({
      platform: 'pangxie',
      name: '螃蟹账号',
      intervalMs: 30 * 60_000,  // 采集智能体：每 30 分钟一轮
      priceBias: 1.18,
      gameFilter: () => true,
      tagBias: ['包赔', '可换绑', '官服'],
      realMode: true,
    });
  }

  async fetchReal(games, now) {
    const allItems = [];
    // 已收录商品 id（直接查库，含在售/下架），用于"整页重复即停止"的增量早退
    const knownIds = new Set(
      dbPrepare('SELECT platform_item_id FROM goods WHERE platform=?').all(this.platform).map(r => r.platform_item_id)
    );

    // 长会话（游戏多）末期页面线程可能退化导致 CDP 超时，每 CHUNK 款游戏重建一次预热会话
    const CHUNK = 6;
    let abortAll = false;
    for (let start = 0; start < games.length && !abortAll; start += CHUNK) {
      const chunk = games.slice(start, start + CHUNK);
      await withHumanMobilePage({ url: 'https://m1.pxb7.com/' }, async (page) => {
      for (let gi = 0; gi < chunk.length; gi++) {
        const game = chunk[gi];
        if (gi > 0) await sleep(pageGap());
        const gameId = String(game.platformGameCode);
        const bizProd = Number(game.bizProd || 1);
        console.log(`[pangxie] 采集 ${game.name} (gameId=${gameId}/bizProd=${bizProd})`);

        let collected = 0;
        let abortRound = false;   // 命中风控挑战 → 终止本轮所有游戏
        let skipGame = false;     // 单次网络抖动 → 仅跳过本游戏
        const maxPage = Math.ceil(MAX_PER_GAME / PAGE_SIZE);

        for (let pg = 1; pg <= maxPage; pg++) {
          const payload = {
            bizProd, pageIndex: pg, pageSize: PAGE_SIZE, gameId, query: '', type: 4,
            mineFav: false, filterDTOList: [], combineFilterList: [],
            posType: 3, fromSubscribe: 0, agreeBargain: 1, zoneJumpType: 2, confirmSubscribe: 0,
          };
          if (pg > 1) await sleep(pageGapInner());

          let res;
          try {
            res = await page.evaluate(h5Fetch, payload);
          } catch (e) {
            console.warn(`[pangxie] ${game.name} 浏览器执行异常，跳过本游戏: ${e.message}`);
            skipGame = true; break;
          }

          if (res.blocked) {
            // 首页遇风控挑战：等 6s 让无感验证再跑一轮，仅重试一次
            if (res.kind === 'challenge' && pg === 1) {
              console.warn(`[pangxie] ${game.name} 首次请求被 WAF 挑战，等待 6s 后重试`);
              await sleep(6000);
              try { res = await page.evaluate(h5Fetch, payload); }
              catch (e) { console.warn(`[pangxie] ${game.name} 重试异常，跳过: ${e.message}`); skipGame = true; break; }
            }
            if (res.blocked && res.kind === 'challenge') {
              console.warn(`[pangxie] ${game.name} 仍被 Aliyun FeiLin 拦截，本轮螃蟹采集提前结束（IP 可能需冷却，不造数）`);
              abortRound = true; break;
            }
            if (res.blocked) {
              console.warn(`[pangxie] ${game.name} 请求超时/网络抖动（${res.kind}），跳过本游戏`);
              skipGame = true; break;
            }
          }

          const list = Array.isArray(res.json?.data) ? res.json.data : [];
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

          // 整页都是已收录商品 → 已追到本地水位，后续页是更旧数据，增量早退
          if (pageKnown === list.length) {
            console.log(`[pangxie] ${game.name} 第 ${pg} 页均为已收录，增量采集提前结束`);
            break;
          }
          if (list.length < PAGE_SIZE || collected >= MAX_PER_GAME) break;
        }

        if (abortRound) { abortAll = true; break; } // 被风控则本轮不再请求其它游戏（避免加重风控）
        if (!skipGame) console.log(`[pangxie] ${game.name} 本轮新增/刷新 ${collected} 条`);
      }
      });
    }

    return allItems;
  }

  /** 将 H5 商品对象归一化为引擎标准结构；无效返回 null */
  mapProduct(p, game, now) {
    const id = p.productId ? String(p.productId) : '';
    if (!id) return null;
    const price = Math.round(Number(p.price) / 100); // 分 → 元
    if (!isFinite(price) || price <= 0 || price > PRICE_MAX) return null;

    // shortTitle 在部分游戏（如原神）里是属性数组 [{name,value}]，只取真正的字符串标题
    const pickStr = (...vs) => {
      for (const v of vs) if (typeof v === 'string' && v.trim()) return v.trim();
      return '';
    };
    const title = pickStr(p.shortTitle, p.productName, p.showTitle).replace(/\s+/g, ' ').slice(0, 140);
    if (!title) return null;

    const tags = ['螃蟹'];
    const attr = Array.isArray(p.attrNameList)
      ? p.attrNameList.map(x => (typeof x === 'string' ? x : x?.name || x?.attrName || '')).filter(Boolean)
      : [];
    tags.push(...attr.slice(0, 8));
    if (p.topAccount) tags.push('顶号');
    if (p.guarantee) tags.push('包赔');
    if (p.verifiedSeller) tags.push('验号');

    let server = '';
    if (typeof p.areaServer === 'string') server = p.areaServer;
    else if (p.areaServer && typeof p.areaServer === 'object') server = p.areaServer.name || p.areaServer.areaName || JSON.stringify(p.areaServer);

    const img = normalizeUrl(p.mainImageUrl || p.productMiniImageUrl);
    const oriPrice = Number(p.oriPrice);
    const bizProd = Number(p.bizProd || game.bizProd || 1);

    return {
      platform_item_id: id,
      game_id: game.id,
      server_name: server,
      title,
      description: pickStr(p.showTitle, p.productName).replace(/\s+/g, ' ').slice(0, 800),
      price,
      original_price: isFinite(oriPrice) && oriPrice > 0 ? Math.round(oriPrice / 100) : price,
      tags: [...new Set(tags)].slice(0, 12),
      images: img ? [img] : [],
      seller: '', // 不采集卖家信息（需求：不展示卖家）
      publish_time: parseTime(p.createTime) || now,
      // 直达原平台商品详情页：PC 详情 https://www.pxb7.com/product/{productId}/{bizProd}
      source_url: `https://www.pxb7.com/product/${id}/${bizProd}`,
    };
  }
}

function parseTime(s) {
  if (!s || typeof s !== 'string') return 0;
  const t = Date.parse(s.replace(' ', 'T') + '+08:00'); // 平台时间为北京时间
  return isFinite(t) ? t : 0;
}

function normalizeUrl(u) {
  if (!u || typeof u !== 'string') return '';
  if (u.startsWith('//')) return 'https:' + u;
  return u.startsWith('http') ? u : '';
}
