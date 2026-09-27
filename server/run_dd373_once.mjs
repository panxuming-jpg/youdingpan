/**
 * 一次性运行 DD373 采集：结果写入 goods 表并输出汇总
 * 用法: node run_dd373_once.mjs
 */
import { Dd373Adapter } from './src/engine/adapters/dd373.js';
import { db } from './src/db.js';
import { closeBrowser } from './src/engine/collector.js';
import fs from 'node:fs';

const now = Date.now();
const ad = new Dd373Adapter();

console.log('[run] 开始 DD373 采集...');
const items = await ad.fetch(now);
console.log(`[run] 采集返回 ${items.length} 条`);

// 持久化（逻辑对齐 engine.runBatch：新商品插入，已存在更新价格/在售状态）
let inserted = 0, updated = 0;
for (const item of items) {
  const exist = db.prepare('SELECT id, price FROM goods WHERE platform=? AND platform_item_id=?')
    .get('dd373', item.platform_item_id);
  if (!exist) {
    const ins = db.prepare(`INSERT INTO goods
      (platform, platform_item_id, game_id, server_name, title, description, price, original_price,
       lowest_price, tags, images, seller, publish_time, status, first_seen, last_seen, miss_count, last_drop, source_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'on', ?, ?, 0, 0, ?)`)
      .run('dd373', item.platform_item_id, item.game_id, item.server_name, item.title,
        item.description || '', item.price, item.original_price ?? item.price,
        item.price, JSON.stringify(item.tags || []), JSON.stringify(item.images || []),
        item.seller || '', item.publish_time || now, now, now, item.source_url || '');
    db.prepare('INSERT INTO price_history (goods_id, price, recorded_at) VALUES (?,?,?)')
      .run(Number(ins.lastInsertRowid), item.price, now);
    inserted++;
  } else {
    db.prepare(`UPDATE goods SET status='on', price=?, lowest_price=MIN(COALESCE(lowest_price, ?), ?), last_seen=?, miss_count=0 WHERE id=?`)
      .run(item.price, item.price, item.price, now, exist.id);
    if (Math.abs(item.price - exist.price) >= 1) {
      db.prepare('INSERT INTO price_history (goods_id, price, recorded_at) VALUES (?,?,?)').run(exist.id, item.price, now);
    }
    updated++;
  }
}
db.prepare(`UPDATE platform_status SET status='normal', last_run=?, total_ok=total_ok+? WHERE platform='dd373'`)
  .run(now, inserted + updated);
db.prepare(`INSERT INTO crawl_logs (platform, ok_count, fail_count, message, created_at) VALUES ('dd373', ?, 0, '手动单次采集', ?)`)
  .run(inserted + updated, now);

console.log(`[run] 入库完成: 新增 ${inserted}, 更新 ${updated}`);

// 按游戏汇总 + 导出明细 JSON
const gameName = id => db.prepare('SELECT name FROM games WHERE id=?').get(id)?.name || `game#${id}`;
const byGame = {};
for (const it of items) {
  (byGame[it.game_id] ||= []).push(it);
}
const summary = [];
for (const [gid, list] of Object.entries(byGame)) {
  const prices = list.map(x => x.price);
  summary.push({
    game: gameName(Number(gid)),
    count: list.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
  });
}
summary.sort((a, b) => b.count - a.count);
console.log('\n===== 按游戏汇总 =====');
for (const s of summary) console.log(`${s.game}: ${s.count} 条, 价格 ${s.minPrice}~${s.maxPrice} 元`);

const out = {
  collectedAt: new Date(now).toISOString(),
  total: items.length,
  inserted, updated,
  summary,
  items: items.map(it => ({
    game: gameName(it.game_id),
    id: it.platform_item_id,
    title: it.title,
    price: it.price,
    server: it.server_name,
    publishTime: it.publish_time ? new Date(it.publish_time).toISOString().replace('T', ' ').slice(0, 19) : '',
    url: it.source_url,
    img: it.images?.[0] || '',
  })),
};
fs.writeFileSync(new URL('./data/dd373_last_run.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\n[run] 明细已导出: server/data/dd373_last_run.json');

await closeBrowser();
process.exit(0);
