import { DatabaseSync } from 'node:sqlite';

// 打开 WAL 副本（触发 checkpoint 读取最新数据）
const db = new DatabaseSync('C:/Users/52212/AppData/Local/Temp/dd373q/app.db');

const cnt = db.prepare("SELECT COUNT(*) c FROM goods WHERE platform='dd373'").get();
console.log('dd373 goods count:', cnt.c);

const byGame = db.prepare(`
  SELECT g.name, COUNT(*) c, MIN(go.price) minp, MAX(go.price) maxp
  FROM goods go JOIN games g ON g.id = go.game_id
  WHERE go.platform='dd373'
  GROUP BY go.game_id ORDER BY c DESC
`).all();
console.log('\n=== 按游戏统计 ===');
for (const r of byGame) console.log(`${r.name}: ${r.c} 条, 价格区间 ${r.minp}~${r.maxp} 元`);

const sample = db.prepare(`
  SELECT go.platform_item_id, g.name game, go.title, go.price, go.server_name, go.publish_time, go.source_url
  FROM goods go JOIN games g ON g.id = go.game_id
  WHERE go.platform='dd373'
  ORDER BY go.publish_time DESC LIMIT 15
`).all();
console.log('\n=== 最新 15 条 ===');
for (const r of sample) {
  const t = r.publish_time ? new Date(r.publish_time).toISOString().replace('T',' ').slice(0,19) : '';
  console.log(`[${r.game}] ${r.title} | ${r.price}元 | ${r.server_name} | ${t} | ${r.source_url}`);
}
db.close();
