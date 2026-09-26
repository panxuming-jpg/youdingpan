// r2 验证：db.js 加载 + schema 创建 + 种子插入
import { db, PLATFORMS } from './server/src/db.js';

const games = db.prepare(`SELECT id, name, short_name FROM games ORDER BY id`).all();
console.log('games 表：', games.length, '条');
console.log('  含无畏契约:', games.some(g => g.name === '无畏契约'));
console.log('  含三角洲行动:', games.some(g => g.name === '三角洲行动'));

const codes = db.prepare(`SELECT platform, game_id, platform_game_code, biz_prod, note FROM platform_game_codes ORDER BY platform, game_id`).all();
console.log('platform_game_codes 表：', codes.length, '条');
for (const c of codes) {
  const g = db.prepare('SELECT name FROM games WHERE id=?').get(c.game_id);
  console.log(`  [${c.platform}] ${g.name} → code=${c.platform_game_code} bizProd=${c.biz_prod || '-'} note=${c.note || '-'}`);
}

// 验证 engine.js 能加载（仅 import 不启动）
const eng = await import('./server/src/engine/engine.js');
console.log('engine.js 加载成功，exports:', Object.keys(eng));

const ads = await import('./server/src/engine/adapters/index.js');
console.log('adapters/index.js 加载成功，ADAPTERS 数量:', ads.ADAPTERS.length);
for (const ad of ads.ADAPTERS) {
  console.log(`  [${ad.platform}] ${ad.name} intervalMs=${ad.intervalMs}`);
}

// 验证 BaseAdapter.loadGames 真实模式查询
for (const ad of ads.ADAPTERS) {
  const gs = ad.loadGames();
  console.log(`  ${ad.platform} loadGames(): ${gs.length} 个游戏有码`);
  for (const g of gs.slice(0, 3)) console.log(`    ${g.name} code=${g.platformGameCode} bizProd=${g.bizProd}`);
}

// 验证 collector.js 加载（不 launch）
const col = await import('./server/src/engine/collector.js');
console.log('collector.js 加载成功，exports:', Object.keys(col));

console.log('\n全部加载验证通过');
process.exit(0);
