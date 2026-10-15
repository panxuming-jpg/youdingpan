// r4 验证：直接调真实适配器的 fetchReal，看能否拿到真实商品
import { db } from './server/src/db.js';
import { B7881Adapter } from './server/src/engine/adapters/b7881.js';
import { PanzhiAdapter } from './server/src/engine/adapters/panzhi.js';

const now = Date.now();

console.log('\n========== 7881 真实采集 ==========');
const ad7881 = new B7881Adapter();
const games7881 = ad7881.loadGames();
console.log(`7881 配置 ${games7881.length} 个游戏：`, games7881.map(g => `${g.name}(${g.platformGameCode})`).join(', '));

try {
  const items = await ad7881.fetchReal(games7881, now);
  console.log(`\n7881 fetchReal 返回 ${items.length} 条商品`);
  for (const it of items.slice(0, 3)) {
    console.log(`  [${it.game_id}] ${it.title.slice(0, 80)}`);
    console.log(`    价格=${it.price} 平台ID=${it.platform_item_id} 服务器=${it.server_name}`);
  }
} catch (e) {
  console.error('7881 采集异常:', e.message);
}

console.log('\n========== 盼之真实采集 ==========');
const adPz = new PanzhiAdapter();
const gamesPz = adPz.loadGames();
console.log(`盼之配置 ${gamesPz.length} 个游戏：`, gamesPz.map(g => `${g.name}(${g.platformGameCode})`).join(', '));

try {
  const items = await adPz.fetchReal(gamesPz, now);
  console.log(`\n盼之 fetchReal 返回 ${items.length} 条商品`);
  for (const it of items.slice(0, 3)) {
    console.log(`  [${it.game_id}] ${it.title.slice(0, 80)}`);
    console.log(`    价格=${it.price} 平台ID=${it.platform_item_id} 服务器=${it.server_name}`);
  }
} catch (e) {
  console.error('盼之采集异常:', e.message);
}

console.log('\n验证完成');
process.exit(0);
