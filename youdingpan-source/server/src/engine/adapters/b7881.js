/**
 * 7881 真实采集适配器
 *
 * 采集方式：headless 打开 https://search.7881.com/{gameCode}-{catCode}-0-0-0.html?pageNum={p}
 *           滚动页面触发并拦截 gw.7881.com/goods-service-api/api/goods/list 的 JSON
 *           {code:0, body:{results:[{goodsId,title,price,originPrice,serverName,carrierName,groupName,createtime,gameId,gameName,...}]}}
 *
 * URL 模式：{gameCode}-{类目码}；类目码存于 platform_game_codes.biz_prod
 *   王者荣耀账号=100001；和平精英/无畏契约/三角洲账号=100003（错用会返回"服务器正在升级"页）
 * 商品 XHR 不是首屏立即发出，需滚动 + 等待约 10~13s。
 *
 * 每款游戏按发布时间最新顺序逐页抓取，单轮上限 100 条（每页 30 条，最多 4 页）；
 * 某一页商品全部已收录则增量早退（后面的更旧），稳态下通常只请求第 1 页。
 */
import { BaseAdapter } from './base.js';
import { openPage, pickJsonResponse } from '../collector.js';
import { dbPrepare } from './dbproxy.js';

// 游戏之间停顿 3~6 秒随机抖动，模拟用户阅读间隔，降低风控概率
function gameGap() {
  return 3000 + Math.floor(Math.random() * 3000);
}
// 翻页停顿 2.5~4s 随机，模拟用户看完一页再点下一页
function pageGap() {
  return 2500 + Math.floor(Math.random() * 1500);
}
// 每轮每游戏最多采集 100 条最新发布商品；7881 每页 30 条，最多翻 4 页
const MAX_PER_GAME = 100;
const PAGE_SIZE = 30;
const MAX_PAGES = Math.ceil(MAX_PER_GAME / PAGE_SIZE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class B7881Adapter extends BaseAdapter {
  constructor() {
    super({
      platform: '7881',
      name: '7881',
      intervalMs: 30 * 60_000,  // 同步智能体：每 30 分钟一轮，单轮 100 上限做增量
      priceBias: 0.88,
      gameFilter: () => true,
      tagBias: ['可换绑'],
      realMode: true,
    });
  }

  async fetchReal(games, now) {
    // 已收录 id：用于增量早退（整页都是已知商品 → 后面更旧，停止翻页）
    const knownIds = new Set(
      dbPrepare('SELECT platform_item_id FROM goods WHERE platform=?').all(this.platform).map(r => r.platform_item_id)
    );
    const allItems = [];
    for (let gi = 0; gi < games.length; gi++) {
      const game = games[gi];
      if (gi > 0) await sleep(gameGap());
      const catCode = game.bizProd || '100001';
      console.log(`[7881] 采集 ${game.name}${game.note ? '(' + game.note + ')' : ''} (${game.platformGameCode}-${catCode})`);

      let added = 0;
      for (let pg = 1; pg <= MAX_PAGES; pg++) {
        const url = `https://search.7881.com/${game.platformGameCode}-${catCode}-0-0-0.html?pageNum=${pg}`;
        let responses = [];
        try {
          ({ responses } = await openPage({
            url,
            waitMs: 13000,   // XHR 约在加载后 10~13s 触发
            scroll: true,    // 滚动触发商品列表 XHR
            xhrFilter: /gw\.7881\.com\/goods-service-api\/api\/goods\/list(?!-preferred)/,
          }));
        } catch (err) {
          console.error(`[7881] ${game.name} 第 ${pg} 页打开失败: ${err.message}`);
          break;
        }
        const hit = pickJsonResponse(responses, d => d?.code === 0 && Array.isArray(d?.body?.results));
        if (!hit) {
          console.warn(`[7881] ${game.name} 第 ${pg} 页未拦到 goods/list XHR（响应 ${responses.length} 条）`);
          break;
        }
        const results = hit.data.body.results || [];
        if (!results.length) break; // 没有更多页
        if (pg === 1) console.log(`[7881] ${game.name} 在架 ${hit.data.body.records ?? '?'}，逐页取最新 ${MAX_PER_GAME} 条`);

        let pageKnown = 0;
        for (const r of results) {
          if (added >= MAX_PER_GAME) break;
          const id = String(r.goodsId);
          if (knownIds.has(id)) pageKnown++;
          const price = Number(r.price);
          if (!isFinite(price) || price <= 0) continue;          // 过滤无效价格
          if (!r.goodsId || !r.title) continue;                   // 过滤缺字段
          // 解析 accountHighlight（JSON 字符串数组）
          let highlights = [];
          try { highlights = JSON.parse(r.accountHighlight || '[]'); } catch {}
          allItems.push({
            platform_item_id: id,
            game_id: game.id,
            server_name: r.serverName && r.serverName !== '全服' ? r.serverName : (r.groupName || r.carrierName || ''),
            title: r.title,
            description: [r.subTitle, highlights.length ? '亮点:' + highlights.join(' / ') : ''].filter(Boolean).join(' | '),
            price,
            original_price: Number(r.originPrice) || price,
            tags: ['7881', r.carrierName].filter(Boolean),
            images: r.defaultImg ? [r.defaultImg] : [],
            seller: r.source || '',
            publish_time: parseTime(r.createtime) || parseTime(r.lastTime) || now,
            // 直达原平台商品详情页：{goodsId}lmth.（"html" 反写防爬）
            source_url: `https://search.7881.com/${r.goodsId}lmth.`,
          });
          knownIds.add(id);
          added++;
        }
        console.log(`[7881] ${game.name} 第 ${pg} 页 ${results.length} 条，累计 ${added} 条`);
        if (added >= MAX_PER_GAME) {
          console.log(`[7881] ${game.name} 已达单轮上限 ${MAX_PER_GAME}，停止翻页`);
          break;
        }
        // 增量早退：整页商品均已收录 → 后续更旧无需再翻
        if (pageKnown >= results.length) {
          console.log(`[7881] ${game.name} 第 ${pg} 页均为已收录，增量同步提前结束`);
          break;
        }
        await sleep(pageGap());
      }
    }
    return allItems;
  }
}

// "2026-09-23 20:35:01" → 毫秒（按本地时区解析）
function parseTime(s) {
  if (!s || typeof s !== 'string') return 0;
  const t = Date.parse(s.replace(' ', 'T'));
  return isFinite(t) ? t : 0;
}
