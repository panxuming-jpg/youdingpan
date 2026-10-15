/**
 * DD373 真实采集适配器
 *
 * 采集方式：headless 打开按发布时间排序的列表页
 *   https://www.dd373.com/s-{code}-0-0-0-0-0-{type}-0-0-0-0-0-{page}-0-2-0.html
 * 页面为 SSR 渲染（商品数据直接内嵌 HTML）；非浏览器请求会被 WAF JS 挑战拦截
 * （返回约 12KB 的空标题挑战页），因此必须走 openPage 真实浏览器渲染后取 DOM。
 *
 * URL 段位含义（s- 后共 15 段，从探测页 pagination/hiddenData 确认）：
 *   第 1 段 = 游戏码（platform_game_code，如王者荣耀 33vu84）
 *   第 7 段 = 商品类型码（biz_prod：大部分游戏 0；鸣潮 49c95j、星穹铁道 e19wb7）
 *   第 12 段 = 页码（第 1 页的 URL 同样是 1；pageGt1Href 模板以 #### 占位）
 *   第 14 段 = 排序（2 = 按发布时间降序）
 *
 * 每页 20 条。单轮每游戏最多抓 100 条最新发布（5 页）；
 * 整页商品均已收录则增量早退（后面的更旧），稳态下通常只请求第 1 页。
 */
import { BaseAdapter } from './base.js';
import { openPage } from '../collector.js';
import { dbPrepare } from './dbproxy.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DD373 阿里云 ESA 滑块验证 cookie（node dd373_login.mjs 人工过滑块后落盘）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, '..', '..', '..', 'data', 'dd373_cookies.json');

function loadCookies() {
  try {
    const arr = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 游戏之间停顿 4~8 秒随机抖动（dd373 连续快速请求会触发 WAF，停顿更保守）
function gameGap() {
  return 4000 + Math.floor(Math.random() * 4000);
}
// 翻页停顿 3~5s 随机，模拟用户看完一页再点下一页
function pageGap() {
  return 3000 + Math.floor(Math.random() * 2000);
}
// 每轮每游戏最多采集 100 条最新发布商品；dd373 每页 20 条，最多翻 5 页
const MAX_PER_GAME = 100;
const PAGE_SIZE = 20;
const MAX_PAGES = Math.ceil(MAX_PER_GAME / PAGE_SIZE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 浏览器内执行的 DOM 提取：dd373 商品条目为 div.goods-list-item.zh-goods-item
const EXTRACT_GOODS = () => {
  const out = [];
  document.querySelectorAll('div.goods-list-item.zh-goods-item').forEach(el => {
    // 详情链接：/detail-{ID}.html（ID 形如 ZH20260926101523-73895，全站唯一）
    const link = el.querySelector('a[href*="/detail-"]');
    const href = link ? (link.getAttribute('href') || '') : '';
    const m = href.match(/\/detail-([\w-]+)\.html/);
    if (!m) return;
    // 价格：.goods-price 内 "￥360.00"
    const priceText = el.querySelector('.goods-price')?.textContent || '';
    const price = Number(priceText.replace(/[^\d.]/g, ''));
    // 标题：账号条目在 .account-info-title（.game-account-flag 为兜底）
    const titleEl = el.querySelector('.account-info-title') || el.querySelector('.game-account-flag');
    // 发布时间：条目内唯一形如 yyyy-MM-dd HH:mm:ss 的 span 文本
    let publishTime = '';
    for (const s of el.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) { publishTime = t; break; }
    }
    // 区服：.game-qufu-attr 内的筛选链接（如 苹果QQ / 全区全服 / 游戏账号）
    const servers = [...el.querySelectorAll('.game-qufu-attr a')]
      .map(a => (a.textContent || '').trim()).filter(Boolean);
    // 图片：懒加载 img 的 data-original（协议相对地址 //xxx）
    const img = el.querySelector('.game-image img');
    const imgSrc = (img && (img.getAttribute('data-original') || img.getAttribute('src'))) || '';
    out.push({
      id: m[1],
      title: (titleEl?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
      price,
      publishTime,
      server: servers[0] || '',
      img: imgSrc.startsWith('//') ? 'https:' + imgSrc : imgSrc,
    });
  });
  return out;
};

export class Dd373Adapter extends BaseAdapter {
  constructor() {
    super({
      platform: 'dd373',
      name: 'DD373',
      intervalMs: 30 * 60_000,  // 每 30 分钟一轮，单轮 100 上限做增量
      priceBias: 0.9,
      gameFilter: () => true,
      tagBias: ['可换绑'],
      realMode: true,
    });
  }

  async fetchReal(games, now) {
    const cookies = loadCookies();
    if (!cookies.length) {
      console.warn('[dd373] 未找到验证 cookie（server/data/dd373_cookies.json）——大概率被滑块拦截，建议运行: node dd373_login.mjs');
    }
    // 已收录 id：用于增量早退（整页都是已知商品 → 后面更旧，停止翻页）
    const knownIds = new Set(
      dbPrepare('SELECT platform_item_id FROM goods WHERE platform=?').all(this.platform).map(r => r.platform_item_id)
    );
    const allItems = [];
    for (let gi = 0; gi < games.length; gi++) {
      const game = games[gi];
      if (gi > 0) await sleep(gameGap());
      const typeSeg = game.bizProd || '0';
      console.log(`[dd373] 采集 ${game.name}${game.note ? '(' + game.note + ')' : ''} (${game.platformGameCode})`);

      let added = 0;
      for (let pg = 1; pg <= MAX_PAGES; pg++) {
        const url = `https://www.dd373.com/s-${game.platformGameCode}-0-0-0-0-0-${typeSeg}-0-0-0-0-0-${pg}-0-2-0.html`;
        let rows = null;
        // WAF 挑战页无商品条目：普通空页重试一次；滑块页重试无效（人工验证 cookie 缺失/过期）
        let sliderBlocked = false;
        for (let attempt = 1; attempt <= 2 && !rows; attempt++) {
          try {
            const { evalResult, title } = await openPage({ url, waitMs: attempt === 1 ? 9000 : 14000, cookies, evaluate: EXTRACT_GOODS });
            const list = Array.isArray(evalResult) ? evalResult : [];
            if (list.length) { rows = list; break; }
            if (title && /验证/.test(title)) { sliderBlocked = true; break; }
            if (attempt === 1) console.warn(`[dd373] ${game.name} 第 ${pg} 页未取到商品，重试`);
          } catch (err) {
            console.error(`[dd373] ${game.name} 第 ${pg} 页打开失败: ${err.message}`);
            break;
          }
        }
        if (sliderBlocked) {
          console.warn(`[dd373] ${game.name} 触发阿里云 ESA 滑块验证（cookie 缺失或失效）——请在项目根目录运行 node dd373_login.mjs 完成一次人工验证后自动恢复`);
          return allItems; // 同轮后续游戏大概率同样被拦，直接返回已抓数据
        }
        if (!rows) break;

        let pageKnown = 0;
        for (const row of rows) {
          if (added >= MAX_PER_GAME) break;
          if (knownIds.has(row.id)) pageKnown++;
          if (!isFinite(row.price) || row.price <= 0) continue;  // 过滤无效价格
          if (!row.title) continue;                              // 过滤缺标题
          allItems.push({
            platform_item_id: row.id,
            game_id: game.id,
            server_name: row.server,
            title: row.title,
            description: '',
            price: row.price,
            original_price: row.price,
            tags: ['DD373'],
            images: row.img ? [row.img] : [],
            seller: '',
            publish_time: parseCnTime(row.publishTime) || now,
            // 直达原平台商品详情页
            source_url: `https://www.dd373.com/detail-${row.id}.html`,
          });
          knownIds.add(row.id);
          added++;
        }
        console.log(`[dd373] ${game.name} 第 ${pg} 页 ${rows.length} 条，累计 ${added} 条`);
        if (added >= MAX_PER_GAME) {
          console.log(`[dd373] ${game.name} 已达单轮上限 ${MAX_PER_GAME}，停止翻页`);
          break;
        }
        // 增量早退：整页商品均已收录 → 后续更旧无需再翻
        if (pageKnown >= rows.length) {
          console.log(`[dd373] ${game.name} 第 ${pg} 页均为已收录，增量同步提前结束`);
          break;
        }
        await sleep(pageGap());
      }
    }
    return allItems;
  }
}

// "2026-09-26 10:15:23"（dd373 页面为北京时间 UTC+8）→ 毫秒时间戳
function parseCnTime(s) {
  const m = s && String(s).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  // 北京时间转 UTC（-8h；Date.UTC 内部自动归一化负值/进位）
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
}
