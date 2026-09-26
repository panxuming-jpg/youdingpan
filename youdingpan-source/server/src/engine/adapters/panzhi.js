/**
 * 盼之代售真实采集适配器
 *
 * 采集方式：headless 打开 https://www.pzds.com/goodsList/{gameId}/{bizProd}[/{page}]
 *           page.evaluate 取 window.__NUXT__.data[0].goodsList（SSR 内嵌 JSON，每页 10 条）
 *           字段：goodsNo, gameId, gameIdName, title, subtitle, simpleMessage, price,
 *                 originalPrice, createTime, onStandTime, goodsImg, sellingPointLabels,
 *                 compensation, bargain, merchantMark
 *
 * SSR 分页：第 1 页为 goodsList/{gameId}/{bizProd}，第 N≥2 页为 goodsList/{gameId}/{bizProd}/{N}。
 * 部分游戏列表 URL 无业务码段（goodsList/{gameId}，如三国杀 43/原神 12/CF 16/星铁 213/暗区 77），
 * 该形态 SSR 不支持翻页（/{gameId}/2 会被当成 bizProd=2），只取首屏 10 条；
 * 其详情链接业务码仍为 6（goodsDetails/{goodsNo}/6，实测）。
 * 每款有业务码的游戏按发布时间最新逐页抓取，单轮上限 100 条（最多 10 页）；
 * 某一页商品全部已收录则增量早退，稳态下通常只请求第 1 页。
 */
import { BaseAdapter } from './base.js';
import { openPage } from '../collector.js';
import { dbPrepare } from './dbproxy.js';

// 游戏页之间停顿 3~6 秒随机抖动，模拟用户阅读间隔
function gameGap() {
  return 3000 + Math.floor(Math.random() * 3000);
}
// 翻页停顿 2.5~4s 随机，模拟用户看完一页再点下一页
function pageGap() {
  return 2500 + Math.floor(Math.random() * 1500);
}
const PRICE_MAX = 100000;  // 过滤 ¥999999 等占位/异常价格
const MAX_PER_GAME = 100;   // 单轮单游戏最多 100 条最新发布
const PAGE_SIZE = 10;
const MAX_PAGES = Math.ceil(MAX_PER_GAME / PAGE_SIZE);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class PanzhiAdapter extends BaseAdapter {
  constructor() {
    super({
      platform: 'panzhi',
      name: '盼之代售',
      intervalMs: 30 * 60_000,  // 同步智能体：每 30 分钟一轮，单轮 100 上限做增量
      priceBias: 1.12,
      gameFilter: g => (g.tags || []).includes('二次元'),
      tagBias: ['包赔', '可换绑'],
      realMode: true,
    });
  }

  async fetchReal(games, now) {
    // 已收录 id：用于增量早退
    const knownIds = new Set(
      dbPrepare('SELECT platform_item_id FROM goods WHERE platform=?').all(this.platform).map(r => r.platform_item_id)
    );
    const allItems = [];
    for (let gi = 0; gi < games.length; gi++) {
      const game = games[gi];
      if (gi > 0) await sleep(gameGap());
      const gameId = game.platformGameCode;
      const bizProd = game.bizProd || '';  // 空=URL 无业务码段，仅首屏 10 条、不翻页
      const basePath = bizProd ? `${gameId}/${bizProd}` : String(gameId);
      const maxPages = bizProd ? MAX_PAGES : 1;
      console.log(`[panzhi] 采集 ${game.name} (gameId=${gameId}/bizProd=${bizProd || '无'})`);

      let added = 0;
      for (let pg = 1; pg <= maxPages; pg++) {
        const url = pg === 1
          ? `https://www.pzds.com/goodsList/${basePath}`
          : `https://www.pzds.com/goodsList/${basePath}/${pg}`;
        let goodsList = null;
        try {
          ({ evalResult: goodsList } = await openPage({
            url,
            waitMs: 8000,
            evaluate: () => {
              try {
                const d = window.__NUXT__ && window.__NUXT__.data;
                if (d && d[0] && Array.isArray(d[0].goodsList)) return d[0].goodsList;
              } catch (e) {}
              return null;
            },
          }));
        } catch (err) {
          console.error(`[panzhi] ${game.name} 第 ${pg} 页打开失败: ${err.message}`);
          break;
        }
        if (!Array.isArray(goodsList) || !goodsList.length) break; // 没有更多页

        let pageValid = 0;
        let pageNew = 0;
        for (const r of goodsList) {
          if (added >= MAX_PER_GAME) break;
          const id = String(r.goodsNo);
          const price = Number(r.price);
          if (!isFinite(price) || price <= 0 || price > PRICE_MAX) continue; // 过滤占位价 999999
          if (!r.goodsNo || !r.title) continue;
          pageValid++;
          if (knownIds.has(id)) continue; // 跨页/置顶位重复，不重复推送
          knownIds.add(id);
          pageNew++;
          const tags = ['盼之'];
          if (r.compensation) tags.push('包赔');
          if (r.bargain) tags.push('可议价');
          if (r.autoDelivery) tags.push('自动发货');
          const highlights = Array.isArray(r.sellingPointLabels) ? r.sellingPointLabels : [];
          allItems.push({
            platform_item_id: id,
            game_id: game.id,
            server_name: r.simpleMessage || r.gameIdName || '',
            title: r.subtitle ? `${r.title}｜${r.subtitle}` : r.title,
            description: [r.simpleMessage, highlights.length ? '皮肤:' + highlights.slice(0, 20).join(' / ') : '']
              .filter(Boolean).join(' | '),
            price,
            original_price: Number(r.originalPrice) || price,
            tags,
            images: r.goodsImg ? [r.goodsImg] : [],
            seller: r.merchantMark || '',
            publish_time: parseTime(r.createTime) || parseTime(r.onStandTime) || now,
            // 盼之详情页 URL 模式：goodsDetails/{goodsNo}/{bizProd}；无业务码段的游戏详情仍用 6（账号）
            source_url: `https://www.pzds.com/goodsDetails/${r.goodsNo}/${bizProd || '6'}`,
          });
          added++;
        }
        console.log(`[panzhi] ${game.name} 第 ${pg} 页 ${goodsList.length} 条（有效 ${pageValid}/新增 ${pageNew}），累计 ${added} 条`);
        if (added >= MAX_PER_GAME) {
          console.log(`[panzhi] ${game.name} 已达单轮上限 ${MAX_PER_GAME}，停止翻页`);
          break;
        }
        // 增量早退：本页没有任何新商品——可能是已追到本地水位，
        // 也可能是该游戏 SSR 深页被钳制为最后一页（盼之部分游戏只给前几页）
        if (pageNew === 0) {
          console.log(`[panzhi] ${game.name} 第 ${pg} 页无新商品，增量同步提前结束`);
          break;
        }
        await sleep(pageGap());
      }
    }
    return allItems;
  }
}

function parseTime(s) {
  if (!s || typeof s !== 'string') return 0;
  const t = Date.parse(s.replace(' ', 'T'));
  return isFinite(t) ? t : 0;
}
