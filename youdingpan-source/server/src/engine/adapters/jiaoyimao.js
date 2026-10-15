/**
 * 交易猫真实采集适配器
 *
 * 采集方式：headless(移动端UA) 打开 https://www.jiaoyimao.com/jg{gameId}/{f-c}/o110/?rId=107&enforcePlat={plat}&newPage=true
 *           拦截 mtop.jiaoyimao.com/h5/mtop.com.jym.layout.pc.goodslist.getunifiedgoodslist 的 JSON
 *           商品位于 data.result.deliverComps[].data，字段：goodsId,title,price,originPrice,serverName,
 *           gameName,description,images,publishName,sellPoints,tags 等
 *
 * 注意：URL 必须带 f{filter}-c{category} 参数（存于 platform_game_codes.note），否则商品 XHR 不触发。
 *       enforcePlat 存于 biz_prod（2=安卓平台,5=全平台）。
 *       该 H5 首屏固定 16 条最新发布；实测各类翻页参数（o110-p2、?page=2）返回的是
 *       混合重排结果而非严格第 2 页，为保证数据正确仅取首屏 16 条，不做翻页。
 */
import { BaseAdapter } from './base.js';
import { openPage, pickJsonResponse } from '../collector.js';

// 游戏页之间停顿 6~12 秒随机抖动，模拟用户阅读间隔（风控敏感期更温和）
function pageGap() {
  return 6000 + Math.floor(Math.random() * 6000);
}
const PRICE_MAX = 100000;
const MAX_PER_GAME = 100;   // 单轮单游戏最多 100 条最新发布
const EMPTY_ABORT = 2;      // 连续 2 款 0 响应即判定限流，本轮收手（避免硬刷加重风控）
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class JiaoyimaoAdapter extends BaseAdapter {
  constructor() {
    super({
      platform: 'jiaoyimao',
      name: '交易猫',
      intervalMs: 30 * 60_000,  // 采集智能体：每 30 分钟一轮，单轮 100 上限做增量
      priceBias: 1.0,
      gameFilter: () => true,
      tagBias: ['官服'],
      realMode: true,
    });
  }

  async fetchReal(games, now) {
    const allItems = [];
    // 每 30 分钟一轮，按轮次轮换游戏顺序：风控只放行前几款时，各游戏轮流占用放行窗口
    const roundIndex = Math.floor(now / this.intervalMs);
    const shift = roundIndex % games.length;
    const ordered = games.map((_, i) => games[(i + shift) % games.length]);
    let consecutiveEmpty = 0;
    for (let gi = 0; gi < ordered.length; gi++) {
      const game = ordered[gi];
      if (gi > 0) await sleep(pageGap());
      const fc = game.note || ''; // f{filter}-c{category}
      const plat = game.bizProd || '2';
      // searchCondition=过滤低质商品（filter_low_quality），各游戏统一参数
      const sc = encodeURIComponent(JSON.stringify({ filter_low_quality: { conditionList: ['1'] } }));
      const url = `https://www.jiaoyimao.com/jg${game.platformGameCode}/${fc}/o110/?rId=107&searchCondition=${sc}&enforcePlat=${plat}&newPage=true`;
      console.log(`[jiaoyimao] 采集 ${game.name} (jg${game.platformGameCode}/${fc}) → ${url}`);
      let responses = [];
      let timeMap = null;
      try {
        ({ responses, evalResult: timeMap } = await openPage({
          url,
          waitMs: 10000,
          scroll: true,
          mobile: true,
          xhrFilter: /getunifiedgoodslist/,
          // 交易猫列表 XHR 不带绝对发布时间，但 SSR 内联数据里每个商品的标签含
          // "N分钟前发布 / N小时前发布 / N天前发布 / 刚刚"。在同页解析 goodsId→相对时长，
          // 页面变体不含该脚本时返回 null（降级为采集时刻，下轮重试）。
          evaluate: () => {
            try {
              let data = window.__INITIAL_DATA__ || null;
              if (!data) {
                for (const s of document.querySelectorAll('script')) {
                  const t = s.textContent || '';
                  const i = t.indexOf('__INITIAL_DATA__=');
                  if (i < 0) continue;
                  const start = t.indexOf('{', i);
                  let depth = 0, end = -1;
                  for (let k = start; k < t.length; k++) {
                    const ch = t[k];
                    if (ch === '{') depth++;
                    else if (ch === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
                  }
                  data = JSON.parse(t.slice(start, end));
                  break;
                }
              }
              if (!data) return null;
              const map = {};
              const re = /^(\d+)\s*(分钟|小时|天)前发布$|^刚刚发布?$/;
              (function walk(o, depth) {
                if (depth > 14 || !o || typeof o !== 'object') return;
                if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
                if (o.goodsId != null) {
                  const buckets = [o.valuableTag, o.tagList, o.tags, o.newPromotionTags, o.promotionTags]
                    .filter(Array.isArray).flat();
                  for (const tg of buckets) {
                    const name = tg && (tg.tagName || (typeof tg === 'string' ? tg : ''));
                    if (name && re.test(name)) { map[String(o.goodsId)] = name; break; }
                  }
                }
                for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
              })(data, 0);
              return Object.keys(map).length ? map : null;
            } catch (e) { return null; }
          },
        }));
      } catch (err) {
        console.error(`[jiaoyimao] ${game.name} 打开页面失败: ${err.message}`);
        consecutiveEmpty++;
        if (consecutiveEmpty >= EMPTY_ABORT) {
          console.warn(`[jiaoyimao] 连续 ${EMPTY_ABORT} 款游戏无响应，疑似限流，本轮提前收手（下轮 ${this.intervalMs / 60000} 分钟后自动重试）`);
          break;
        }
        continue;
      }
      // 采集观测时刻：真实上架时间 = 观测时刻 - 相对时长
      const fetchedAt = Date.now();
      const hit = pickJsonResponse(responses, d => Array.isArray(d?.data?.result?.deliverComps));
      if (!hit) {
        console.warn(`[jiaoyimao] ${game.name} 未拦到 getunifiedgoodslist（响应 ${responses.length} 条）`);
        consecutiveEmpty++;
        if (consecutiveEmpty >= EMPTY_ABORT) {
          console.warn(`[jiaoyimao] 连续 ${EMPTY_ABORT} 款游戏 0 条，疑似触发风控，本轮提前收手（避免加重封禁，下轮自动轮换重试）`);
          break;
        }
        continue;
      }
      consecutiveEmpty = 0;
      const comps = hit.data.data.result.deliverComps || [];
      const items = comps.map(c => c.data).filter(Boolean);
      let valid = 0;
      let timed = 0;
      for (const r of items) {
        if (valid >= MAX_PER_GAME) {
          console.log(`[jiaoyimao] ${game.name} 已达单轮上限 ${MAX_PER_GAME}，停止追加`);
          break;
        }
        const price = Number(r.price);
        if (!isFinite(price) || price <= 0 || price > PRICE_MAX) continue;
        if (!r.goodsId || !r.title) continue;
        valid++;
        const tags = ['交易猫'];
        if (Array.isArray(r.tags)) tags.push(...r.tags.map(t => typeof t === 'string' ? t : t?.name).filter(Boolean));
        if (Array.isArray(r.promotionTags)) tags.push(...r.promotionTags.map(t => typeof t === 'string' ? t : t?.name).filter(Boolean));
        const sellPoints = Array.isArray(r.sellPoints) ? r.sellPoints.map(s => typeof s === 'string' ? s : s?.name || '').filter(Boolean) : [];
        // images 是对象数组 [{auditImage, originImage, ...}]，取原图/审核图 URL
        const imgList = Array.isArray(r.images)
          ? r.images.map(i => (i && typeof i === 'object' ? (i.auditImage || i.originImage) : i)).filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 5)
          : [];
        // 真实上架时间：观测时刻 - "多久之前发布"；取不到相对时长时用观测时刻兜底
        const offset = timeMap ? relLabelToMs(timeMap[String(r.goodsId)]) : null;
        const publishTime = offset != null ? fetchedAt - offset : fetchedAt;
        if (offset != null) timed++;
        allItems.push({
          platform_item_id: String(r.goodsId),
          game_id: game.id,
          server_name: r.serverName || r.jymCategory?.categoryName || '',
          title: r.title,
          description: [r.description, sellPoints.length ? '亮点:' + sellPoints.slice(0, 15).join(' / ') : ''].filter(Boolean).join(' | '),
          price,
          original_price: Number(r.originPrice) || price,
          tags: [...new Set(tags)].slice(0, 12),
          images: imgList,
          seller: r.publishName || String(r.sellerId || ''),
          publish_time: publishTime,
          // 直达原平台商品详情页（需求5：账号点击跳转到原平台对应链接）
          source_url: `https://www.jiaoyimao.com/goods/${r.goodsId}.html`,
        });
      }
      console.log(`[jiaoyimao] ${game.name} 取到 ${items.length} 条，有效 ${valid} 条（含相对发布时间 ${timed} 条）`);
    }
    return allItems;
  }
}

// "15分钟前发布 / 2小时前发布 / 3天前发布 / 刚刚" → 距今毫秒数；无法解析返回 null
function relLabelToMs(label) {
  if (!label) return null;
  let m;
  if (/刚刚/.test(label)) return 0;
  if ((m = label.match(/(\d+)\s*分钟前/))) return Number(m[1]) * 60_000;
  if ((m = label.match(/(\d+)\s*小时前/))) return Number(m[1]) * 3_600_000;
  if ((m = label.match(/(\d+)\s*天前/))) return Number(m[1]) * 86_400_000;
  return null;
}
