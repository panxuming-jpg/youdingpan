/**
 * 智能体一：采集智能体（后台定时任务）
 * - 每 30 分钟一轮，串行调度各平台适配器（一次只跑一个平台，平台间 8~25s 随机抖动）
 * - 适配器通过 collector.js 以拟人方式（随机 viewport/鼠标轨迹/分段滚动/随机停留）
 *   打开平台列表页，拦 XHR/取 SSR 数据，只抓最新 100 条/游戏，增量写入共享 SQLite
 * - 监控新上架 / 改价（写 price_history）/ 下架（窗口 + 连续未重现判定）并推送 SSE
 *
 * 智能体二（检索/展示）位于 routes/：纯读 SQLite 提供商品列表、详情、价格历史等 API，
 * 与采集智能体只通过数据库解耦，互不影响。
 */
import { db, PLATFORMS } from '../db.js';
import { ADAPTERS } from './adapters/index.js';
import { dispatchEvent, dispatchFavEvent } from './push.js';
import { rebuildIndex, rebuildAuctionIndex, addGoods } from '../search.js';

const OFF_SHELF_MISSES = 2; // 连续 2 轮（约 1 小时）未抓取到 → 下架
// 窗口边界：只对最近 WINDOW_MS 内见过（last_seen ≥ windowEdge）但本轮未抓到的商品做 miss++。
// 窗口外的旧商品（已被新商品挤出"最新发布"页）不动，避免误判历史长尾商品下架。
// 2 小时窗口 = 4 轮采集（每轮 30 分钟），配合 OFF_SHELF_MISSES=2 实现"连续 2 轮未在窗口内重现 → 下架"。
const WINDOW_MS = 2 * 3600_000;

// 串行队列：一次只跑一个适配器，跑完接下一个，模拟普通用户顺序浏览
// 每轮间隔另加 8~25 秒随机抖动，避免固定节奏被风控识别
const QUEUE_GAP_MIN_MS = 8_000;
const QUEUE_GAP_MAX_MS = 25_000;

const state = new Map();       // platform -> { nextRunAt, busy }
let runningAdapter = null;     // 当前正在采集的适配器平台 key（null = 空闲）

export function startEngine() {
  const now = Date.now();
  rebuildIndex(); // 启动时全量重建搜索倒排索引
  rebuildAuctionIndex(); // 拍卖倒排索引（标题分词）

  for (const ad of ADAPTERS) {
    ad.rehydrate(now);
    if (ad.realMode) {
      console.log(`[engine] ${ad.name} 真实采集适配器启动，恢复 ${ad.pool.size} 条已采集商品`);
    } else if (ad.pool.size === 0) {
      ad.seed(now);
      console.log(`[engine] ${ad.name} 适配器初始化，预置 ${ad.pool.size} 条兜底商品`);
    } else {
      console.log(`[engine] ${ad.name} 适配器恢复 ${ad.pool.size} 条在售商品`);
    }
    // 首轮错峰启动（每个平台 +6s），全部串行
    state.set(ad.platform, { nextRunAt: Date.now() + 5_000 + ADAPTERS.indexOf(ad) * 6_000, busy: false });
  }

  setInterval(tick, 1000);
  console.log('[engine] 采集引擎已启动（串行模式，每平台间隔 8~25s 随机抖动）');
}

function tick() {
  // 串行队列：有平台在采集时，其他平台一律等待，模拟普通用户顺序浏览
  if (runningAdapter) return;

  const now = Date.now();
  for (const ad of ADAPTERS) {
    const st = state.get(ad.platform);
    if (!st || st.busy || now < st.nextRunAt) continue;
    const ps = db.prepare('SELECT running FROM platform_status WHERE platform=?').get(ad.platform);
    if (ps && !ps.running) { st.nextRunAt = now + 30_000; continue; }

    runningAdapter = ad.platform;
    st.busy = true;
    st.nextRunAt = now + ad.intervalMs;
    runBatch(ad, now).catch(err => {
      console.error(`[engine] ${ad.name} 采集异常:`, err.message);
      logCrawl(ad.platform, 0, 0, `同步异常: ${err.message}`, 'error');
    }).finally(() => {
      st.busy = false;
      runningAdapter = null;
      // 队列抖动：跑完后等 8~25s 再让下一个平台开始，模拟用户阅读间隔
      const gap = QUEUE_GAP_MIN_MS + Math.floor(Math.random() * (QUEUE_GAP_MAX_MS - QUEUE_GAP_MIN_MS));
      for (const other of ADAPTERS) {
        const os = state.get(other.platform);
        if (!os) continue;
        if (os.nextRunAt <= Date.now() + 1000) os.nextRunAt = Date.now() + gap;
      }
    });
    break; // 一次只跑一个平台
  }
}

async function runBatch(ad, now) {
  let items = [];
  try {
    items = await ad.fetch(now);
  } catch (err) {
    db.prepare(`UPDATE platform_status SET status='error' WHERE platform=?`).run(ad.platform);
    logCrawl(ad.platform, 0, 0, err.message, 'error');
    return;
  }

  const batchStart = now;
  let okCount = 0;
  const fetchedIds = new Set();

  for (const item of items) {
    fetchedIds.add(item.platform_item_id);
    const exist = db.prepare('SELECT * FROM goods WHERE platform=? AND platform_item_id=?')
      .get(ad.platform, item.platform_item_id);

    if (!exist) {
      const ins = db.prepare(`INSERT INTO goods
        (platform, platform_item_id, game_id, server_name, title, description, price, original_price,
         lowest_price, tags, images, seller, publish_time, status, first_seen, last_seen, miss_count, last_drop, source_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'on', ?, ?, 0, 0, ?)`)
        .run(ad.platform, item.platform_item_id, item.game_id, item.server_name, item.title,
          item.description || '', item.price, item.original_price ?? item.price,
          item.price, JSON.stringify(item.tags || []), JSON.stringify(item.images || []),
          item.seller || '', item.publish_time || now, now, now, item.source_url || '');
      const goodsId = Number(ins.lastInsertRowid);
      db.prepare('INSERT INTO price_history (goods_id, price, recorded_at) VALUES (?,?,?)').run(goodsId, item.price, now);
      addGoods(goodsId, `${item.title} ${item.server_name}`); // 倒排索引增量更新
      okCount++;
      dispatchEvent('new', shapeForEvent(goodsId, ad, item));
    } else {
      // 已存在商品（含重新上架）：商品 id 相同只更新价格与在售状态，
      // 标题/标签/图片/直达链接等信息保持首次采集时的内容不变
      const oldPrice = exist.price;
      let lastDrop = exist.last_drop || 0;
      if (Math.abs(item.price - oldPrice) >= 1) {
        db.prepare('INSERT INTO price_history (goods_id, price, recorded_at) VALUES (?,?,?)').run(exist.id, item.price, now);
        if (item.price < oldPrice) {
          const dropAmount = oldPrice - item.price;
          lastDrop = dropAmount;
          dispatchEvent('drop', shapeForEvent(exist.id, ad, { ...item, price: item.price }), { dropAmount });
          // 收藏降价提醒：仅当现价低于收藏时基线价才真正通知（push.js 内判定）
          dispatchFavEvent('fav_drop', shapeForEvent(exist.id, ad, { ...item, price: item.price }), { dropAmount });
        }
      }
      db.prepare(`UPDATE goods SET status='on', price=?, lowest_price=MIN(COALESCE(lowest_price, ?), ?),
                 last_drop=?, last_seen=?, miss_count=0 WHERE id=?`)
        .run(item.price, item.price, item.price, lastDrop, now, exist.id);
      okCount++;
    }
  }

  // 下架判定：窗口边界逻辑——只对最近 WINDOW_MS 内见过但本轮未抓到的商品做 miss++
  // 窗口外的旧商品（已被新商品挤出"最新发布"页）不动，避免误判历史长尾商品下架
  const windowEdge = batchStart - WINDOW_MS;
  const onSale = db.prepare(`SELECT id, platform_item_id, game_id, server_name, title, price, platform, last_seen, miss_count FROM goods WHERE platform=? AND status='on'`)
    .all(ad.platform);
  for (const g of onSale) {
    if (fetchedIds.has(g.platform_item_id)) continue;       // 本轮抓到，跳过
    if (g.last_seen < windowEdge) continue;                 // 窗口外旧商品，不动
    const newMiss = (g.miss_count || 0) + 1;
    if (newMiss >= OFF_SHELF_MISSES) {
      db.prepare(`UPDATE goods SET status='off', miss_count=? WHERE id=?`).run(newMiss, g.id);
      dispatchEvent('off', shapeForEvent(g.id, ad, g));
      dispatchFavEvent('fav_off', shapeForEvent(g.id, ad, g));
    } else {
      db.prepare('UPDATE goods SET miss_count=? WHERE id=?').run(newMiss, g.id);
    }
  }

  db.prepare(`UPDATE platform_status SET status='normal', last_run=?, total_ok=total_ok+? WHERE platform=?`)
    .run(now, okCount, ad.platform);
  logCrawl(ad.platform, okCount, items.length === 0 ? 1 : 0, '正常');
}

function shapeForEvent(goodsId, ad, item) {
  const game = db.prepare('SELECT name, short_name FROM games WHERE id=?').get(item.game_id) || { name: '', short_name: '' };
  return {
    id: goodsId,
    platform: ad.platform,
    platform_name: ad.name || PLATFORMS[ad.platform],
    game_id: item.game_id,
    game_name: game.short_name || game.name,
    server_name: item.server_name,
    title: item.title,
    price: item.price,
  };
}

function logCrawl(platform, okCount, failCount, message, level = 'info') {
  db.prepare('INSERT INTO crawl_logs (platform, ok_count, fail_count, message, created_at) VALUES (?,?,?,?,?)')
    .run(platform, okCount, failCount, level === 'error' ? message : `${message}（${okCount} 条）`, Date.now());
  // 日志裁剪：只保留最近 500 条
  db.prepare(`DELETE FROM crawl_logs WHERE id NOT IN (SELECT id FROM crawl_logs ORDER BY created_at DESC LIMIT 500)`).run();
}
