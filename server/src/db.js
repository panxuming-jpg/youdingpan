import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  nickname TEXT,
  avatar TEXT DEFAULT '',
  email TEXT DEFAULT '',
  is_admin INTEGER DEFAULT 0,
  push_channels TEXT DEFAULT '["inapp"]',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS verify_codes (
  phone TEXT PRIMARY KEY,
  code TEXT,
  expire INTEGER
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  short_name TEXT DEFAULT '',
  pinyin TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  category TEXT DEFAULT '手游',
  status INTEGER DEFAULT 1,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS game_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT '官服'
);
CREATE TABLE IF NOT EXISTS goods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  platform_item_id TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  server_name TEXT DEFAULT '',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  original_price REAL,
  lowest_price REAL,
  tags TEXT DEFAULT '[]',
  images TEXT DEFAULT '[]',
  seller TEXT DEFAULT '',
  publish_time INTEGER,
  status TEXT DEFAULT 'on',
  first_seen INTEGER,
  last_seen INTEGER,
  miss_count INTEGER DEFAULT 0,
  last_drop REAL DEFAULT 0,
  source_url TEXT DEFAULT '',
  UNIQUE(platform, platform_item_id)
);
-- 老库升级：补 source_url 列（SQLite 不支持 ADD COLUMN IF NOT EXISTS，try 忽略重复列错误）
`);
try { db.exec('ALTER TABLE goods ADD COLUMN source_url TEXT DEFAULT ""'); } catch (e) { /* 列已存在 */ }
// 监控任务关键词过滤：空格分隔，命中任一关键词（标题/区服）才触发提醒，空串=不过滤
try { db.exec(`ALTER TABLE monitor_tasks ADD COLUMN keywords TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }
// 游戏展示顺序（前端 tab 排序依据；未设置的排最后）
try { db.exec('ALTER TABLE games ADD COLUMN sort_order INTEGER DEFAULT 999'); } catch (e) { /* 列已存在 */ }
const GAME_ORDER = [
  '王者荣耀', '和平精英', '三角洲行动', '无畏契约', '三国杀',
  '原神', '火影忍者', '鸣潮', '穿越火线（CF）', '崩坏：星穹铁道', '暗区突围',
];
const updOrder = db.prepare('UPDATE games SET sort_order=? WHERE name=?');
GAME_ORDER.forEach((name, i) => updOrder.run(i + 1, name));
db.exec(`
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goods_id INTEGER NOT NULL,
  price REAL NOT NULL,
  recorded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ph_goods ON price_history(goods_id, recorded_at);
CREATE TABLE IF NOT EXISTS monitor_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  platforms TEXT NOT NULL,
  server_id INTEGER,
  price_min REAL,
  price_max REAL,
  notify_types TEXT NOT NULL,
  drop_threshold REAL DEFAULT 0,
  channels TEXT DEFAULT '["inapp"]',
  status TEXT DEFAULT 'on',
  trigger_count INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER,
  goods_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS notified_events (
  user_id INTEGER NOT NULL,
  goods_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (user_id, goods_id, type)
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  goods_id INTEGER NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (user_id, goods_id)
);
-- 收藏商品降价监控：收藏时以当时价格为基线（baseline_price），
-- 之后采集到低于基线的价格或商品下架时，向收藏用户发送 fav_drop / fav_off 提醒
CREATE TABLE IF NOT EXISTS fav_price_watch (
  user_id INTEGER NOT NULL,
  goods_id INTEGER NOT NULL,
  baseline_price REAL,
  status TEXT DEFAULT 'on',
  created_at INTEGER,
  PRIMARY KEY (user_id, goods_id)
);
CREATE TABLE IF NOT EXISTS crawl_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  ok_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  message TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS platform_status (
  platform TEXT PRIMARY KEY,
  name TEXT,
  running INTEGER DEFAULT 1,
  status TEXT DEFAULT 'normal',
  last_run INTEGER,
  total_ok INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at INTEGER
);
-- 平台 × 游戏 游戏码映射（采集器据此构造各平台列表页 URL）
CREATE TABLE IF NOT EXISTS platform_game_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  platform_game_code TEXT NOT NULL,
  biz_prod TEXT DEFAULT '',
  note TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  UNIQUE(platform, game_id, platform_game_code)
);
`);

// ---------- 种子数据 ----------
const now = Date.now();

const gameCount = db.prepare('SELECT COUNT(*) AS c FROM games').get().c;
if (gameCount === 0) {
  const insGame = db.prepare(
    'INSERT INTO games (name, short_name, pinyin, tags, category, status, created_at) VALUES (?,?,?,?,?,?,?)'
  );
  const insServer = db.prepare('INSERT INTO game_servers (game_id, name, type) VALUES (?,?,?)');

  const seedGames = [
    { name: '原神', short_name: '原神', pinyin: 'yuanshen', tags: ['手游', '二次元'], category: '手游',
      servers: [['官服-天空岛', '官服'], ['官服-世界树', '官服'], ['B服-蒲公英', '渠道服'], ['官服-万风港', '官服']] },
    { name: '崩坏：星穹铁道', short_name: '星穹铁道', pinyin: 'xingqiongtiedao', tags: ['手游', '二次元'], category: '手游',
      servers: [['官服-天穹市', '官服'], ['官服-流云渡', '官服'], ['B服-黑塔', '渠道服']] },
    { name: '王者荣耀', short_name: '王者', pinyin: 'wangzherongyao', tags: ['手游', '竞技', '腾讯'], category: '手游',
      servers: [['安卓Q区', '官服'], ['苹果Q区', '官服'], ['安卓微信区', '官服'], ['苹果微信区', '官服']] },
    { name: '和平精英', short_name: '和平精英', pinyin: 'hepingjingying', tags: ['手游', '竞技', '腾讯'], category: '手游',
      servers: [['安卓Q区', '官服'], ['苹果Q区', '官服'], ['微信区', '官服']] },
    { name: '永劫无间', short_name: '永劫', pinyin: 'yongjiawujian', tags: ['端游', '竞技'], category: '端游',
      servers: [['网易官服', '官服'], [' steam国服', '官服']] },
    { name: '梦幻西游', short_name: '梦幻', pinyin: 'menghuanxiyou', tags: ['端游', '网易'], category: '端游',
      servers: [['紫禁城', '官服'], ['汴梁城', '官服'], ['青花瓷', '官服'], ['逍遥城', '官服'], ['再续前缘', '官服']] },
    { name: '逆水寒', short_name: '逆水寒', pinyin: 'nishuihan', tags: ['端游', '网易'], category: '端游',
      servers: [['盛世年华', '官服'], ['紫禁之巅', '官服'], ['龙腾四海', '官服']] },
    { name: '地下城与勇士', short_name: 'DNF', pinyin: 'dnf', tags: ['端游', '腾讯'], category: '端游',
      servers: [['跨五-浙江一区', '官服'], ['跨六-江苏一区', '官服'], ['跨一-广东一区', '官服']] },
    { name: '英雄联盟', short_name: 'LOL', pinyin: 'yingxionglianmeng', tags: ['端游', '腾讯', '竞技'], category: '端游',
      servers: [['艾欧尼亚', '官服'], ['峡谷之巅', '官服'], ['德玛西亚', '官服']] },
    { name: '剑网3', short_name: '剑网3', pinyin: 'jianwang3', tags: ['端游'], category: '端游',
      servers: [['电信一区', '官服'], ['网通一区', '官服'], ['双线一区', '官服']] },
    { name: '无畏契约', short_name: '无畏契约', pinyin: 'wuweixueyue', tags: ['端游', '腾讯', '竞技', 'FPS'], category: '端游',
      servers: [['全平台', '官服'], ['电信一区', '官服'], ['网通一区', '官服']] },
    { name: '三角洲行动', short_name: '三角洲', pinyin: 'sanjiaozhouxingdong', tags: ['端游', '腾讯', 'FPS'], category: '端游',
      servers: [['PC端', '官服'], ['安卓端', '官服'], ['苹果端', '官服']] },
  ];

  for (const g of seedGames) {
    const r = insGame.run(g.name, g.short_name, g.pinyin, JSON.stringify(g.tags), g.category, 1, now);
    for (const [name, type] of g.servers) insServer.run(r.lastInsertRowid, name.trim(), type);
  }
}

const platCount = db.prepare('SELECT COUNT(*) AS c FROM platform_status').get().c;
if (platCount === 0) {
  const ins = db.prepare('INSERT INTO platform_status (platform, name, running, status, last_run, total_ok) VALUES (?,?,?,?,?,?)');
  const plats = [
    ['jiaoyimao', '交易猫'], ['panzhi', '盼之代售'],
    ['pangxie', '螃蟹账号'], ['7881', '7881'],
    ['dd373', 'DD373'], ['5173', '5173'],
  ];
  for (const [p, n] of plats) ins.run(p, n, 1, 'normal', null, 0);
}
// 老库清理：禁用已下线的模拟兜底平台（藏宝阁），让其不再被引擎调度
// 注意：5173 已升级为真实采集平台（s5173.js），不在禁用之列
db.prepare(`UPDATE platform_status SET running=0 WHERE platform IN ('cangbaoge')`).run();

// dd373 / 5173 平台注册（幂等，兼容已初始化的旧库）
db.prepare(`INSERT INTO platform_status (platform, name, running, status, last_run, total_ok)
  SELECT 'dd373', 'DD373', 1, 'normal', NULL, 0
  WHERE NOT EXISTS (SELECT 1 FROM platform_status WHERE platform='dd373')`).run();
db.prepare(`INSERT INTO platform_status (platform, name, running, status, last_run, total_ok)
  SELECT '5173', '5173', 1, 'normal', NULL, 0
  WHERE NOT EXISTS (SELECT 1 FROM platform_status WHERE platform='5173')`).run();
// 5173 升级为真实采集平台后确保处于启用状态（老库可能残留 running=0）
db.prepare(`UPDATE platform_status SET running=1, name='5173' WHERE platform='5173'`).run();

// 修正游戏短名：无畏契约的旧短名"瓦罗兰特"统一为官方游戏名"无畏契约"
db.prepare(`UPDATE games SET short_name='无畏契约' WHERE name='无畏契约' AND short_name='瓦罗兰特'`).run();

// 老库清理：删除所有模拟兜底商品（需求4：只保留真实抓取的数据）
// - 藏宝阁平台所有商品（已下线平台）
// - 模拟商品 id 含 '-'（如 7881-xxx / PANZHI-xxx / JIAOYIMAO-xxx / CANGBAOGE-xxx / 5173-xxx 等）
//   5173 真实商品 id 为纯数字（goods_no），不受影响
db.prepare(`DELETE FROM goods WHERE platform IN ('cangbaoge')`).run();
db.prepare(`DELETE FROM goods WHERE platform_item_id LIKE '%-%'`).run();
// 同步清理孤立的价格历史、收藏与收藏监控
db.prepare(`DELETE FROM price_history WHERE goods_id NOT IN (SELECT id FROM goods)`).run();
db.prepare(`DELETE FROM favorites WHERE goods_id NOT IN (SELECT id FROM goods)`).run();
db.prepare(`DELETE FROM fav_price_watch WHERE goods_id NOT IN (SELECT id FROM goods)`).run();
// 老库清理：历史任务/通知中的藏宝阁平台引用（已下线平台，无适配器）
db.prepare(`DELETE FROM monitor_tasks WHERE platforms LIKE '%cangbaoge%'`).run();
db.prepare(`DELETE FROM platform_game_codes WHERE platform='cangbaoge'`).run();
db.prepare(`DELETE FROM notifications WHERE type IN ('new','drop','off') AND goods_id NOT IN (SELECT id FROM goods)`).run();

// 修复 7881 历史坏详情链接：旧适配器写入的 {goodsId}lmth.（"html"反写防爬）现已 404，
// 真实详情页为 search 子域 /{goodsId}.html（幂等 REPLACE，只处理 lmth. 结尾的旧链接）
db.prepare(`UPDATE goods SET source_url = REPLACE(source_url, 'lmth.', '.html')
  WHERE platform='7881' AND source_url LIKE '%lmth.'`).run();

const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  db.prepare('INSERT INTO users (phone, nickname, is_admin, push_channels, created_at) VALUES (?,?,?,?,?)')
    .run('13800000000', '管理员', 1, '["inapp"]', now);
}
// 老库清理：删除历史平台公告（需求3：不再展示平台介绍类公告）
db.prepare(`DELETE FROM announcements`).run();

// ---------- 增量种子补全：已运行的 DB 重启时补全新增游戏 + 平台游戏码映射 ----------
// 用 INSERT OR IGNORE + NOT EXISTS 子查询保证幂等
const insGameIgnore = db.prepare('INSERT OR IGNORE INTO games (name, short_name, pinyin, tags, category, status, created_at) VALUES (?,?,?,?,?,?,?)');
const insServerIfAbsent = db.prepare(`INSERT INTO game_servers (game_id, name, type)
  SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM game_servers WHERE game_id=? AND name=?)`);

// 新增游戏（与 seedGames 同步维护，确保旧 DB 重启时也能补）
const extraGames = [
  { name: '无畏契约', short_name: '无畏契约', pinyin: 'wuweixueyue', tags: ['端游','腾讯','竞技','FPS'], category: '端游',
    servers: [['全平台','官服'],['电信一区','官服'],['网通一区','官服']] },
  { name: '三角洲行动', short_name: '三角洲', pinyin: 'sanjiaozhouxingdong', tags: ['端游','腾讯','FPS'], category: '端游',
    servers: [['PC端','官服'],['安卓端','官服'],['苹果端','官服']] },
  // 第二批新增游戏（原神/崩坏：星穹铁道已在 seedGames 中，这里补其余 5 款）
  { name: '三国杀', short_name: '三国杀', pinyin: 'sanguosha', tags: ['手游','卡牌'], category: '手游', servers: [] },
  { name: '火影忍者', short_name: '火影忍者', pinyin: 'huoyingrenzhe', tags: ['手游','二次元'], category: '手游', servers: [] },
  { name: '鸣潮', short_name: '鸣潮', pinyin: 'mingchao', tags: ['手游','二次元'], category: '手游', servers: [] },
  { name: '穿越火线（CF）', short_name: '穿越火线', pinyin: 'chuanyuehuoxian', tags: ['手游','FPS','腾讯'], category: '手游', servers: [] },
  { name: '暗区突围', short_name: '暗区突围', pinyin: 'anqutuwei', tags: ['手游','FPS','腾讯'], category: '手游', servers: [] },
];
for (const g of extraGames) {
  insGameIgnore.run(g.name, g.short_name, g.pinyin, JSON.stringify(g.tags), g.category, 1, now);
  const row = db.prepare('SELECT id FROM games WHERE name=?').get(g.name);
  if (!row) continue;
  for (const [name, type] of g.servers) insServerIfAbsent.run(row.id, name.trim(), type, row.id, name.trim());
}

// 平台 × 游戏 游戏码映射（采集器据此构造各平台列表页 URL；探测阶段成果）
const codeSeed = [
  // 7881：biz_prod 列存"类目码"，4 款头部游戏账号类目统一为 100003
  ['7881', '王者荣耀', 'A2775', '100003', '安卓版'],
  ['7881', '和平精英', 'A5454', '100003', ''],
  ['7881', '无畏契约', 'A5954', '100003', '手游'],
  ['7881', '三角洲行动', 'A5776', '100003', ''],
  // 盼之：4 款头部游戏全覆盖；biz_prod=业务类型（6=账号）
  ['panzhi', '王者荣耀', '7', '6', ''],
  ['panzhi', '和平精英', '8', '6', ''],
  ['panzhi', '无畏契约', '231', '6', ''],
  ['panzhi', '三角洲行动', '391', '6', ''],
  // 交易猫：移动端URL jg{gameId}/{note}/o110/；biz_prod=enforcePlat，note=f{filter}-c{category}
  ['jiaoyimao', '王者荣耀', '1002416', '2', 'f1724247-c1724248'],
  ['jiaoyimao', '和平精英', '1006473', '2', 'f2125467-c2125468'],
  ['jiaoyimao', '无畏契约', '2000595-5', '5', 'f5527010-c5527011'],
  ['jiaoyimao', '三角洲行动', '2007840', '2', 'f8845003-c8845004'],
  // 螃蟹：4 款全覆盖；biz_prod=1（账号）
  ['pangxie', '王者荣耀', '10013', '1', ''],
  ['pangxie', '和平精英', '10011', '1', ''],
  ['pangxie', '无畏契约', '154999114350603', '1', ''],
  ['pangxie', '三角洲行动', '10371', '1', ''],
  // 螃蟹：第二批 7 款
  ['pangxie', '三国杀', '150111809421339', '1', ''],
  ['pangxie', '原神', '10026', '1', ''],
  ['pangxie', '火影忍者', '10032', '1', ''],
  ['pangxie', '鸣潮', '10302', '1', ''],
  ['pangxie', '穿越火线（CF）', '10039', '1', ''],
  ['pangxie', '崩坏：星穹铁道', '10161', '1', ''],
  ['pangxie', '暗区突围', '10110', '1', ''],
  // 交易猫：第二批 7 款（biz_prod=enforcePlat，note=f-c；URL 带低质过滤 searchCondition）
  ['jiaoyimao', '三国杀', '1002480', '2', 'f1979731-c1979732'],
  ['jiaoyimao', '原神', '1009609', '2', 'f1856397-c1856398'],
  ['jiaoyimao', '火影忍者', '1003132', '2', 'f2033413-c2033414'],
  ['jiaoyimao', '鸣潮', '2007615', '2', 'f7973003-c7973004'],
  ['jiaoyimao', '穿越火线（CF）', '1005668-5', '5', 'f2103394-c2103395'],
  ['jiaoyimao', '崩坏：星穹铁道', '2000334', '2', 'f4545017-c4545018'],
  ['jiaoyimao', '暗区突围', '1012857', '2', 'f2241365-c2241366'],
  // 7881：第二批 7 款，账号类目统一 100003
  ['7881', '三国杀', 'A5683', '100003', ''],
  ['7881', '原神', 'A5653', '100003', ''],
  ['7881', '火影忍者', 'A5468', '100003', ''],
  ['7881', '鸣潮', 'A5752', '100003', ''],
  ['7881', '穿越火线（CF）', 'G68', '100003', ''],
  ['7881', '崩坏：星穹铁道', 'A5701', '100003', ''],
  ['7881', '暗区突围', 'A5692', '100003', ''],
  // 盼之：第二批 7 款；biz_prod 为空表示列表 URL 仅 goodsList/{gameId}（无业务码段），仅取首屏
  ['panzhi', '三国杀', '43', '', ''],
  ['panzhi', '原神', '12', '', ''],
  ['panzhi', '火影忍者', '11', '6', ''],
  ['panzhi', '鸣潮', '303', '6', ''],
  ['panzhi', '穿越火线（CF）', '16', '', ''],
  ['panzhi', '崩坏：星穹铁道', '213', '', ''],
  ['panzhi', '暗区突围', '77', '', ''],
  // dd373：11 款全覆盖，按发布时间排序；biz_prod 存 URL 第 7 段类型码（大部分游戏 0；鸣潮=49c95j、星穹铁道=e19wb7）
  ['dd373', '王者荣耀', '33vu84', '', ''],
  ['dd373', '和平精英', 's25gb3', '', ''],
  ['dd373', '三角洲行动', 'gp1gaj', '', ''],
  ['dd373', '无畏契约', 'a2d697', '', ''],
  ['dd373', '三国杀', 'tgu3c3', '', ''],
  ['dd373', '原神', 'uuuw1v', '', ''],
  ['dd373', '火影忍者', 'n162b3', '', ''],
  ['dd373', '鸣潮', '8gmxpn', '49c95j', ''],
  ['dd373', '穿越火线（CF）', 'mmgv1b', '', ''],
  ['dd373', '崩坏：星穹铁道', '282cu3', 'e19wb7', ''],
  ['dd373', '暗区突围', 'cvnevp', '', ''],
  // 5173：11 款全覆盖，g/accounts 接口 sort=1 即按发布时间倒序；platform_game_code 存 game_id
  ['5173', '王者荣耀', '28', '', ''],
  ['5173', '和平精英', '29', '', ''],
  ['5173', '三角洲行动', '386', '', ''],
  ['5173', '无畏契约', '152', '', ''],
  ['5173', '三国杀', '241', '', ''],
  ['5173', '原神', '243', '', ''],
  ['5173', '火影忍者', '252', '', ''],
  ['5173', '鸣潮', '578', '', ''],
  ['5173', '穿越火线（CF）', '17', '', ''],
  ['5173', '崩坏：星穹铁道', '642', '', ''],
  ['5173', '暗区突围', '247', '', ''],
];
// 清理已废弃的旧映射（交易猫旧 gameCode g2416 等，被新 jg1002416 等替代）
db.prepare(`DELETE FROM platform_game_codes WHERE platform='jiaoyimao' AND platform_game_code IN ('g2416','g6473','g15029','g23529')`).run();
// 清理 7881 已废弃映射：A2705(王者苹果) 与 A6389(三角洲国际服)、G5706(无畏端游)，统一用用户指定的 4 码
db.prepare(`DELETE FROM platform_game_codes WHERE platform='7881' AND platform_game_code IN ('A2705','A6389','G5706')`).run();

// upsert：已运行的旧库重启时同步修正后的类目码/备注
const insCode = db.prepare(`INSERT INTO platform_game_codes (platform, game_id, platform_game_code, biz_prod, note, enabled)
  VALUES (?,?,?,?,?,1)
  ON CONFLICT(platform, game_id, platform_game_code) DO UPDATE SET biz_prod=excluded.biz_prod, note=excluded.note, enabled=1`);
for (const [platform, gameName, code, bizProd, note] of codeSeed) {
  const g = db.prepare('SELECT id FROM games WHERE name=?').get(gameName);
  if (!g) continue;
  insCode.run(platform, g.id, code, bizProd, note);
}

// 'all' 为"全部平台"聚合选项：仅用于筛选/监控匹配，不产生采集数据
export const PLATFORMS = {
  all: '全部平台',
  jiaoyimao: '交易猫',
  panzhi: '盼之代售',
  pangxie: '螃蟹账号',
  7881: '7881',
  dd373: 'DD373',
  5173: '5173',
};

// 真实采集平台（不含聚合选项 'all'）
export const REAL_PLATFORMS = Object.keys(PLATFORMS).filter(p => p !== 'all');

export function parseJSON(v, dflt) {
  if (v === null || v === undefined) return dflt;
  try { const r = JSON.parse(v); return r ?? dflt; } catch { return dflt; }
}

// ---------- 游拍卖板块：表结构 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  server_id INTEGER,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  start_price REAL NOT NULL,
  increment REAL NOT NULL,
  reserve_price REAL,
  deposit_rate REAL DEFAULT 0.1,
  duration INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  extend_count INTEGER DEFAULT 0,
  max_extend INTEGER DEFAULT 10,
  status TEXT DEFAULT 'pending',
  winner_id INTEGER,
  final_price REAL,
  order_id INTEGER,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auction_status_end ON auctions(status, end_at);
CREATE INDEX IF NOT EXISTS idx_auction_seller ON auctions(seller_id);
CREATE INDEX IF NOT EXISTS idx_auction_game ON auctions(game_id);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bids_user ON bids(user_id);

CREATE TABLE IF NOT EXISTS auction_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT DEFAULT 'pending_payment',
  paid_at INTEGER,
  confirmed_at INTEGER,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ao_buyer ON auction_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_ao_seller ON auction_orders(seller_id);

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  balance REAL DEFAULT 10000.0,
  frozen REAL DEFAULT 0.0,
  created_at INTEGER
);
`);

// 给所有老用户补 wallet（演示模式每人 10000 模拟金）
const walletCount = db.prepare('SELECT COUNT(*) AS c FROM wallets').get().c;
if (walletCount === 0) {
  const users = db.prepare('SELECT id FROM users').all();
  const insWallet = db.prepare('INSERT INTO wallets (user_id, balance, frozen, created_at) VALUES (?,10000.0,0,?)');
  for (const u of users) insWallet.run(u.id, now);
}

// ---------- 付费会员 + 担保交易支付：表结构 ----------
db.exec(`
-- 平台可配置项（后台可改：免费查看限额、会员价格、提现规则等）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 统一支付单：会员订阅 / 拍卖订单共用，唯一单号可溯源
CREATE TABLE IF NOT EXISTS pay_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  scene TEXT NOT NULL,              -- member | auction
  ref_id INTEGER,                   -- scene=auction 时为 auction_orders.id
  subject TEXT NOT NULL,
  amount REAL NOT NULL,
  channel TEXT DEFAULT '',          -- wechat | alipay | mock
  status TEXT DEFAULT 'pending',    -- pending | paid | closed | timeout
  expire_at INTEGER,
  paid_at INTEGER,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_po_user ON pay_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_scene ON pay_orders(scene, status);
-- 免费用户商品详情查看记录（永久累计去重计数；mode=daily 时按 created_at 当日计）
CREATE TABLE IF NOT EXISTS goods_view_logs (
  user_id INTEGER NOT NULL,
  goods_id INTEGER NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (user_id, goods_id)
);
-- 卖家余额提现单
CREATE TABLE IF NOT EXISTS withdraw_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  fee REAL DEFAULT 0,
  channel TEXT NOT NULL,            -- wechat | alipay
  account TEXT NOT NULL,
  status TEXT DEFAULT 'pending',    -- pending | paid | rejected
  remark TEXT DEFAULT '',
  created_at INTEGER,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wd_user ON withdraw_orders(user_id, created_at DESC);
-- 全量资金流水（会员支付、拍卖担保、结算、退款、提现、手续费）
CREATE TABLE IF NOT EXISTS fund_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                  -- 关联用户；平台收入类为空
  biz TEXT NOT NULL,                -- member_pay | auction_pay | escrow_settle | refund | withdraw | withdraw_reject | fee
  amount REAL NOT NULL,
  direction TEXT NOT NULL,          -- in | out
  ref_no TEXT DEFAULT '',
  channel TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fl_user ON fund_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fl_biz ON fund_logs(biz, created_at DESC);
`);

// 用户会员有效期（毫秒时间戳，0/NULL=非会员）
try { db.exec('ALTER TABLE users ADD COLUMN member_expire_at INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }
// 拍卖订单担保交易扩展列
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN pay_order_no TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN ship_company TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN ship_no TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN shipped_at INTEGER`); } catch (e) { /* 列已存在 */ }
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN auto_confirm_at INTEGER`); } catch (e) { /* 列已存在 */ }
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN after_sale_reason TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }
try { db.exec(`ALTER TABLE auction_orders ADD COLUMN refunded_at INTEGER`); } catch (e) { /* 列已存在 */ }

// 平台可配置项默认值（幂等；后台可修改）
const DEFAULT_SETTINGS = {
  free_view_limit: '10',        // 免费用户可查看商品详情数量上限
  view_count_mode: 'permanent', // permanent=永久累计 | daily=每日重置
  member_price: '9.9',          // 会员月卡价格（元）
  member_days: '30',            // 会员单次订阅天数
  member_benefits: '解锁全部商品详情查看，不限次数；新上架/降价提醒优先送达',
  order_fee_rate: '0.05',       // 拍卖订单平台手续费率（确认收货时从货款扣除）
  auto_confirm_days: '7',       // 卖家发货后自动确认收货天数
  withdraw_min: '0',            // 单笔最低提现金额
  withdraw_fee_rate: '0',       // 提现手续费率
  withdraw_free_threshold: '0', // 单笔提现 ≥ 该金额免手续费（0=不启用）
  // ---------- 自营交易与信任体系（PRD v2.0） ----------
  self_commission_rate: '0.06',   // 自营交易佣金费率（结算时从货款扣除，PRD 3.3 建议 5-8%）
  compensation_fee: '100',        // 找回包赔服务费（元/单，买家承担）
  appraisal_fee: '50',            // 鉴号专家服务费（元/次，买家承担）
  self_pay_timeout_min: '30',     // 自营订单待支付超时分钟数
  self_auto_confirm_days: '7',    // 交接完成后自动确认收货天数
  seller_sign_hours: '24',        // 卖家包赔协议签署时限（小时）
  compensation_days: '180',       // 包赔保障期（天，自确认收货起算）
  comp_pool_accrual: '0.3',       // 赔付资金池计提比例（包赔费 × 比例入池）
  expert_share: '0.7',            // 鉴号专家分成比例
  trial_appraise_count: '2',      // 专家试鉴定单数（完成后转正）
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

export function getSetting(key, dflt = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : dflt;
}
export function getSettingNum(key, dflt = 0) {
  const n = Number(getSetting(key, ''));
  return Number.isFinite(n) ? n : dflt;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}

// 会员判断与开通/续费（有效期顺延：在 max(当前有效期, 现在) 基础上 +days）
export function isMember(userId) {
  const u = db.prepare('SELECT member_expire_at FROM users WHERE id=?').get(userId);
  return !!u && (u.member_expire_at || 0) > Date.now();
}
export function extendMembership(userId, days) {
  const u = db.prepare('SELECT member_expire_at FROM users WHERE id=?').get(userId);
  const base = Math.max(Date.now(), u?.member_expire_at || 0);
  const expire = base + days * 86_400_000;
  db.prepare('UPDATE users SET member_expire_at=? WHERE id=?').run(expire, userId);
  return expire;
}

export function fundLog({ userId = null, biz, amount, direction, refNo = '', channel = '', remark = '' }) {
  db.prepare('INSERT INTO fund_logs (user_id, biz, amount, direction, ref_no, channel, remark, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(userId, biz, amount, direction, refNo, channel, remark, Date.now());
}

// ============================================================
// 自营交易与信任体系（PRD v2.0）：表结构
// ============================================================

// 用户扩展：实名认证 + 卖家资质
try { db.exec('ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ""'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN id_card TEXT DEFAULT ""'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN face_verified INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE users ADD COLUMN seller_status TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ } // ''|pending|approved|rejected
try { db.exec('ALTER TABLE users ADD COLUMN seller_reject_reason TEXT DEFAULT ""'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN seller_ban_until INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ } // 24h 内驳回≥3 暂停发布 72h

// C2C 卖家信用体系：支付宝/微信信用分绑定 + 综合信用等级 + 活跃时间戳（在线状态依据）
try { db.exec('ALTER TABLE users ADD COLUMN alipay_credit_score INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ } // 0=未绑定
try { db.exec('ALTER TABLE users ADD COLUMN wechat_credit_score INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ } // 0=未绑定
try { db.exec("ALTER TABLE users ADD COLUMN credit_grade TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ } // 综合分→优秀|良好|一般|较差
try { db.exec('ALTER TABLE users ADD COLUMN last_active_at INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }

db.exec(`
-- 账号归属凭证（FR-A1）：注册时间页/首次充值账单/实名认证页/常用登录设备截图
CREATE TABLE IF NOT EXISTS seller_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  type TEXT NOT NULL,               -- register_page | first_bill | realname_page | device_shot
  images TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending',    -- pending | approved | rejected
  reject_reason TEXT DEFAULT '',
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_proof_user ON seller_proofs(user_id, status);

-- 自营账号商品 Listing（FR-A2/A3/A4）
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  server_name TEXT DEFAULT '',
  channel TEXT DEFAULT '',
  account_id TEXT DEFAULT '',       -- 账号标识，列表/详情一律脱敏
  assets_json TEXT DEFAULT '{}',    -- 结构化资产（段位/等级/皮肤数/英雄数/关键资产清单）
  raw_images_json TEXT DEFAULT '[]',-- 卖家原始截图 3-15 张（证据留存）
  gen_images_json TEXT DEFAULT '[]',-- 一键生成标准化展示图（4 张）
  price REAL NOT NULL,
  support_compensation INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',    -- pending | on | rejected | locked | sold | offline | review(复核)
  reject_reason TEXT DEFAULT '',
  verified_until INTEGER DEFAULT 0, -- 「已鉴·相符」标识有效期
  listed_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_listing_status ON listings(status, listed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_seller ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listing_game ON listings(game_id, status);

-- 估值记录（FR-B）：保留历史，展示取最新
CREATE TABLE IF NOT EXISTS valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  low REAL, high REAL, mid REAL,
  score INTEGER,                    -- 性价比分 min(100, round(mid/price*70))
  confidence TEXT DEFAULT 'low',    -- high | mid | low
  basis_json TEXT DEFAULT '[]',     -- 依据因子 3-5 项
  note TEXT DEFAULT '',
  sample_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'rule',       -- llm | rule
  valued_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_val_listing ON valuations(listing_id, valued_at DESC);

-- 自营订单（FR-A5/A6/A7）
CREATE TABLE IF NOT EXISTS self_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  listing_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  game_id INTEGER,
  price REAL NOT NULL,              -- 商品价款
  compensation_fee REAL DEFAULT 0,  -- 包赔服务费（独立记账）
  appraisal_fee REAL DEFAULT 0,     -- 鉴号服务费（独立记账）
  total REAL NOT NULL,              -- 实付合计
  status TEXT DEFAULT 'pending_payment', -- pending_payment|paid|handover|await_confirm|completed|cancelled|refunding|refunded|seller_appealed|compensated_closed
  pay_order_no TEXT DEFAULT '',
  handover_step INTEGER DEFAULT 0,  -- 交接六步进度 0-6
  valuation_snapshot_json TEXT DEFAULT '', -- 下单时点估值快照（固化）
  refund_reason TEXT DEFAULT '',
  refund_requested_at INTEGER,
  buyer_real_name TEXT DEFAULT '',
  seller_real_name TEXT DEFAULT '',
  created_at INTEGER, paid_at INTEGER, completed_at INTEGER,
  auto_confirm_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_so_buyer ON self_orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_so_seller ON self_orders(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_so_status ON self_orders(status, created_at);

-- 包赔协议（FR-D1）
CREATE TABLE IF NOT EXISTS compensation_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  buyer_signed_at INTEGER,
  seller_signed_at INTEGER,
  sign_deadline INTEGER,            -- 卖家签署截止
  status TEXT DEFAULT 'pending_seller', -- pending_seller | active | expired | void
  terms_json TEXT DEFAULT '',
  created_at INTEGER
);

-- 理赔单（FR-D3/D4）
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  evidence_json TEXT DEFAULT '[]',
  timeline_text TEXT DEFAULT '',
  status TEXT DEFAULT 'submitted',  -- submitted | reviewing | approved | rejected
  ai_advice TEXT DEFAULT '',        -- AI 收证初核建议
  decision TEXT DEFAULT '',
  payout_amount REAL DEFAULT 0,
  appeal_of INTEGER,                -- 申诉复用原单：指向被驳回的单
  created_at INTEGER, decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_claim_status ON claims(status, created_at DESC);
`);
try { db.exec('ALTER TABLE claims ADD COLUMN recovered_at INTEGER'); } catch (e) { /* 列已存在 */ }
db.exec(`

-- 鉴号单（FR-C2/C3/C4）
CREATE TABLE IF NOT EXISTS appraisals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  order_id INTEGER,                 -- 下单前申请时为空
  buyer_id INTEGER NOT NULL,
  expert_id INTEGER,
  game_id INTEGER,
  fee REAL DEFAULT 0,
  status TEXT DEFAULT 'pending_payment', -- pending_payment|pending_accept|in_progress|reported|closed|reassigned
  conclusion TEXT DEFAULT '',       -- match | partial | mismatch | incapable
  report_json TEXT DEFAULT '',
  created_at INTEGER, paid_at INTEGER, accepted_at INTEGER, reported_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_appr_status ON appraisals(status, created_at);

-- 鉴号专家（FR-C1）
CREATE TABLE IF NOT EXISTS experts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  qual_images TEXT DEFAULT '[]',
  status TEXT DEFAULT 'applying',   -- applying | trial | approved | suspended
  trial_done INTEGER DEFAULT 0,
  created_at INTEGER, reviewed_at INTEGER,
  UNIQUE(user_id, game_id)
);

-- 订单三方会话消息（FR-E1）
CREATE TABLE IF NOT EXISTS order_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  sender TEXT NOT NULL,             -- buyer | seller | ai | system
  content TEXT NOT NULL,
  meta_json TEXT DEFAULT '',        -- {event, level} 播报事件/风险等级
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_om_order ON order_messages(order_id, created_at);

-- 证据链：只可追加不可编辑（FR-E2）
CREATE TABLE IF NOT EXISTS evidence_chain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  type TEXT NOT NULL,               -- pay | material | proof | message | report | sign | claim | risk | settle
  actor TEXT DEFAULT '',
  detail_json TEXT DEFAULT '',
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ec_order ON evidence_chain(order_id, created_at);

-- 风险事件（FR-E3）
CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  user_id INTEGER,
  type TEXT NOT NULL,               -- offsite | phishing | credential_ask | silence
  detail TEXT DEFAULT '',
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_re_order ON risk_events(order_id, created_at DESC);

-- 卖家违约记录（FR-D1 逾期不签 / FR-D4 追偿）
CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  type TEXT NOT NULL,               -- sign_overdue | claim_recovery | appraisal_mismatch
  detail TEXT DEFAULT '',
  created_at INTEGER
);

-- 交易电子合同（买家支付成功即生成，买卖双方即时电子签署，与纸质合同同等法律效力）
CREATE TABLE IF NOT EXISTS e_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  contract_no TEXT UNIQUE NOT NULL,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  subject TEXT DEFAULT '',            -- 合同标的（游戏·区服·账号掩码）
  amount REAL DEFAULT 0,              -- 合同价款
  terms_json TEXT DEFAULT '',         -- 合同全文条款
  hash TEXT DEFAULT '',               -- 合同内容 SHA-256 存证
  buyer_signed_at INTEGER,            -- 买家签署时间（担保支付成功即签署）
  seller_signed_at INTEGER,           -- 卖家签署时间
  status TEXT DEFAULT 'pending_seller', -- pending_seller | signed
  created_at INTEGER, signed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ec_status ON e_contracts(status, created_at DESC);
`);

// 赔付资金池余额（来源：包赔费计提 fund_logs biz=comp_accrual；出账：biz=comp_payout）
export function compPoolBalance() {
  const inSum = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fund_logs WHERE biz='comp_accrual' AND direction='in'").get().s;
  const outSum = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fund_logs WHERE biz='comp_payout' AND direction='out'").get().s;
  return Math.round((inSum - outSum) * 100) / 100;
}

// ---------- C2C 卖家信用 / 在线状态（商品卡片、详情、订单共用） ----------
const ONLINE_WINDOW = 5 * 60_000; // 5 分钟内有心跳视为在线

export function isSellerOnline(lastActiveAt) {
  return (lastActiveAt || 0) > Date.now() - ONLINE_WINDOW;
}

export function sellerActiveText(lastActiveAt) {
  if (!lastActiveAt) return '离线';
  const diff = Date.now() - lastActiveAt;
  if (diff < ONLINE_WINDOW) return '当前在线';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前在线`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前在线`;
  return `${Math.floor(diff / 86_400_000)} 天前在线`;
}

// 综合信用等级：取已绑定渠道信用分均值（芝麻/微信支付分区间 350-950）
export function creditGrade(alipayScore, wechatScore) {
  const scores = [alipayScore, wechatScore].filter(s => s > 0);
  if (!scores.length) return '';
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 750) return '优秀';
  if (avg >= 700) return '良好';
  if (avg >= 650) return '一般';
  return '较差';
}

export function sellerCreditInfo(userId) {
  const u = db.prepare('SELECT nickname, alipay_credit_score, wechat_credit_score, credit_grade, last_active_at FROM users WHERE id=?').get(userId);
  if (!u) return null;
  return {
    seller_name: u.nickname || '',
    credit_grade: u.credit_grade || '',
    alipay_credit_score: u.alipay_credit_score || 0,
    wechat_credit_score: u.wechat_credit_score || 0,
    online: isSellerOnline(u.last_active_at),
    last_active_text: sellerActiveText(u.last_active_at),
  };
}

// ============================================================
// 模块 F 买家追账号维权 + 模块 G 全国派出所检索（PRD F/G）
// ============================================================
db.exec(`
-- 维权案：买家账号被找回后发起的追账号维权（民事起诉/刑事报案/包赔）
CREATE TABLE IF NOT EXISTS rights_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verify', -- pending_verify|filed|rejected|docs_ready|submitted|in_progress|closed_done|closed
  claim_types TEXT DEFAULT '["civil"]',          -- civil 民事起诉 / criminal 刑事报案 / compensation 包赔
  recover_at INTEGER, scenario TEXT, loss REAL, contacted_seller INTEGER DEFAULT 0,
  materials TEXT DEFAULT '[]',                   -- 买家上传自证图片 URL 数组
  reject_reason TEXT DEFAULT '', freeze_amount REAL DEFAULT 0,
  court_name TEXT DEFAULT '', case_no TEXT DEFAULT '', result TEXT DEFAULT '',
  created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rc_order ON rights_cases(order_id, status);
CREATE INDEX IF NOT EXISTS idx_rc_buyer ON rights_cases(buyer_id, created_at DESC);

-- 维权案事件流（只可追加，供详情页时间线与文书事实段落取材）
CREATE TABLE IF NOT EXISTS rights_events (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, actor TEXT, type TEXT, content TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_revt_case ON rights_events(case_id, created_at);

-- 维权文书（kind: complaint 民事起诉状 | report_pack 报案材料包 | cert 交易存证证明）
CREATE TABLE IF NOT EXISTS rights_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, kind TEXT, title TEXT, html TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_rdoc_case ON rights_documents(case_id, created_at DESC);

-- 全国派出所检索库（演示数据，以官方公布为准）
CREATE TABLE IF NOT EXISTS police_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, province TEXT NOT NULL, city TEXT, district TEXT,
  address TEXT, phone TEXT, officer TEXT DEFAULT '', officer_badge TEXT DEFAULT '', jurisdiction TEXT DEFAULT '',
  hours TEXT DEFAULT '', lng REAL, lat REAL, source TEXT DEFAULT '演示数据（以官方公布为准）',
  updated_at INTEGER, stale INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ps_geo ON police_stations(province, city, district);

-- 派出所信息纠错反馈
CREATE TABLE IF NOT EXISTS police_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, station_id INTEGER, user_id INTEGER, issue TEXT, status TEXT DEFAULT 'open', created_at INTEGER);
`);
// 老库升级：反馈处理结果备注列（管理端 resolve 时写入 fixed_text）
try { db.exec(`ALTER TABLE police_feedback ADD COLUMN fix_note TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }

// ---------- 种子数据：演示派出所（仅当表为空时插入；电话统一 110 转接，不编造警官与真实号码） ----------
const policeCount = db.prepare('SELECT COUNT(*) AS c FROM police_stations').get().c;
if (policeCount === 0) {
  // 15 列全占位符；officer/officer_badge 传空串（不编造警官信息），stale 初始 0
  const insPs = db.prepare(`INSERT INTO police_stations
    (name, province, city, district, address, phone, officer, officer_badge, jurisdiction, hours, lng, lat, source, updated_at, stale)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const SRC = '演示数据（以官方公布为准）';
  const stations = [
    // 北京 4 所
    ['北京市公安局海淀分局中关村派出所', '北京市', '北京市', '海淀区', '北京市海淀区中关村大街 29 号', '以 110 转接为准', '中关村地区', '24 小时接警', 116.316, 39.983],
    ['北京市公安局朝阳分局朝外大街派出所', '北京市', '北京市', '朝阳区', '北京市朝阳区朝阳门外大街 16 号', '以 110 转接为准', '朝外地区', '24 小时接警', 116.446, 39.923],
    ['北京市公安局西城分局广安门内派出所', '北京市', '北京市', '西城区', '北京市西城区广安门内大街 124 号', '以 110 转接为准', '广安门内地区', '24 小时接警', 116.363, 39.891],
    ['北京市公安局朝阳分局望京派出所', '北京市', '北京市', '朝阳区', '北京市朝阳区望京西园四区 401 号', '以 110 转接为准', '望京地区', '24 小时接警', 116.470, 40.002],
    // 上海 4 所
    ['上海市公安局黄浦分局半淞园路派出所', '上海市', '上海市', '黄浦区', '上海市黄浦区中山南路 1029 号', '以 110 转接为准', '半淞园地区', '24 小时接警', 121.488, 31.211],
    ['上海市公安局徐汇分局徐家汇派出所', '上海市', '上海市', '徐汇区', '上海市徐汇区肇嘉浜路 2044 号', '以 110 转接为准', '徐家汇商圈', '24 小时接警', 121.437, 31.173],
    ['上海市公安局静安分局南京西路派出所', '上海市', '上海市', '静安区', '上海市静安区南京西路 629 号', '以 110 转接为准', '南京西路地区', '24 小时接警', 121.445, 31.224],
    ['上海市公安局浦东分局潍坊新村派出所', '上海市', '上海市', '浦东新区', '上海市浦东新区潍坊路 137 号', '以 110 转接为准', '潍坊新村地区', '24 小时接警', 121.521, 31.221],
    // 广州 4 所
    ['广州市公安局越秀区分局北京路派出所', '广东省', '广州市', '越秀区', '广州市越秀区中山四路 360 号', '以 110 转接为准', '北京路商圈', '24 小时接警', 113.281, 23.128],
    ['广州市公安局天河区分局天河南派出所', '广东省', '广州市', '天河区', '广州市天河区天河路 168 号', '以 110 转接为准', '天河城商圈', '24 小时接警', 113.329, 23.130],
    ['广州市公安局荔湾区分局多宝路派出所', '广东省', '广州市', '荔湾区', '广州市荔湾区多宝路 298 号', '以 110 转接为准', '多宝地区', '24 小时接警', 113.244, 23.116],
    ['广州市公安局海珠区分局瑞宝派出所', '广东省', '广州市', '海珠区', '广州市海珠区新港西路 882 号', '以 110 转接为准', '瑞宝地区', '24 小时接警', 113.297, 23.092],
    // 深圳 4 所
    ['深圳市公安局福田分局华强北派出所', '广东省', '深圳市', '福田区', '深圳市福田区华强北路 1048 号', '以 110 转接为准', '华强北商圈', '24 小时接警', 114.086, 22.543],
    ['深圳市公安局南山分局粤海派出所', '广东省', '深圳市', '南山区', '深圳市南山区科技园科苑路 15 号', '以 110 转接为准', '粤海街道', '24 小时接警', 113.943, 22.529],
    ['深圳市公安局罗湖分局东门派出所', '广东省', '深圳市', '罗湖区', '深圳市罗湖区人民南路 1009 号', '以 110 转接为准', '东门商圈', '24 小时接警', 114.122, 22.540],
    ['深圳市公安局龙岗分局坂田派出所', '广东省', '深圳市', '龙岗区', '深圳市龙岗区坂田街道中康西路 2 号', '以 110 转接为准', '坂田街道', '24 小时接警', 114.055, 22.620],
    // 杭州 4 所
    ['杭州市公安局上城区分局小营派出所', '浙江省', '杭州市', '上城区', '杭州市上城区解放路 298 号', '以 110 转接为准', '小营地区', '24 小时接警', 120.175, 30.244],
    ['杭州市公安局西湖区分局灵隐派出所', '浙江省', '杭州市', '西湖区', '杭州市西湖区天目山路 522 号', '以 110 转接为准', '灵隐地区', '24 小时接警', 120.126, 30.275],
    ['杭州市公安局拱墅区分局武林派出所', '浙江省', '杭州市', '拱墅区', '杭州市拱墅区武林路 365 号', '以 110 转接为准', '武林地区', '24 小时接警', 120.161, 30.276],
    ['杭州市公安局滨江区分局西兴派出所', '浙江省', '杭州市', '滨江区', '杭州市滨江区江陵路 106 号', '以 110 转接为准', '西兴地区', '24 小时接警', 120.211, 30.196],
    // 成都 4 所
    ['成都市公安局青羊区分局草堂派出所', '四川省', '成都市', '青羊区', '成都市青羊区草堂寺街 19 号', '以 110 转接为准', '草堂地区', '24 小时接警', 104.023, 30.658],
    ['成都市公安局锦江区分局牛市口派出所', '四川省', '成都市', '锦江区', '成都市锦江区东大路 166 号', '以 110 转接为准', '牛市口地区', '24 小时接警', 104.090, 30.650],
    ['成都市公安局武侯区分局桂溪派出所', '四川省', '成都市', '武侯区', '成都市武侯区天府大道北段 118 号', '以 110 转接为准', '桂溪地区', '24 小时接警', 104.065, 30.575],
    ['成都市公安局成华区分局建设路派出所', '四川省', '成都市', '成华区', '成都市成华区建设路 200 号', '以 110 转接为准', '建设路地区', '24 小时接警', 104.101, 30.660],
    // 武汉 3 所
    ['武汉市公安局东湖新技术开发区分局关东派出所', '湖北省', '武汉市', '洪山区', '武汉市洪山区珞喻路 667 号', '以 110 转接为准', '光谷地区', '24 小时接警', 114.405, 30.509],
    ['武汉市公安局江岸区分局大智路派出所', '湖北省', '武汉市', '江岸区', '武汉市江岸区中山大道 1520 号', '以 110 转接为准', '大智路地区', '24 小时接警', 114.290, 30.583],
    ['武汉市公安局武昌区分局首义派出所', '湖北省', '武汉市', '武昌区', '武汉市武昌区中山路 168 号', '以 110 转接为准', '首义地区', '24 小时接警', 114.305, 30.554],
    // 西安 3 所
    ['西安市公安局新城分局西一路派出所', '陕西省', '西安市', '新城区', '西安市新城区西一路 54 号', '以 110 转接为准', '西一路地区', '24 小时接警', 108.948, 34.261],
    ['西安市公安局碑林分局柏树林派出所', '陕西省', '西安市', '碑林区', '西安市碑林区柏树林街 32 号', '以 110 转接为准', '柏树林地区', '24 小时接警', 108.960, 34.243],
    ['西安市公安局雁塔分局小寨路派出所', '陕西省', '西安市', '雁塔区', '西安市雁塔区长安南路 102 号', '以 110 转接为准', '小寨商圈', '24 小时接警', 108.945, 34.222],
  ];
  for (const [name, province, city, district, address, phone, jurisdiction, hours, lng, lat] of stations) {
    insPs.run(name, province, city, district, address, phone, '', '', jurisdiction, hours, lng, lat, SRC, now, 0);
  }
}

// ---------- 种子数据：自营安全交易市场（/self）演示在售商品 ----------
// 幂等：account_id 为固定 demo_ 前缀，已存在则跳过，重启不翻倍。
// 字段与 seller.js 发布/审核流程一致：status='on'（GET /self/listings 过滤 on/locked），listed_at 上架时间，
// verified_until 部分带「已鉴·相符」标识；assets_json 用 asset_templates.js 各游戏模板 key。
// 卖家分散到 12 个已 approved 且带信用分的用户；估值沿用 engine/valuation.js 的 valueListing（无 LLM Key 自动规则兜底）。
const SEED_SELLERS = [4, 7, 10, 13, 14, 17, 18, 21, 22, 25, 26, 29]; // users 表中 seller_status='approved'，覆盖优秀/良好/一般各信用等级
const SEED_IMGS = [
  '/uploads/1790485423096-3mqbn0.png', '/uploads/1792759574274-0j2u4p.png', '/uploads/1792759574322-48gp2n.png',
  '/uploads/1792759582973-66zmv5.png', '/uploads/1792759870286-ge5m7o.jpg', '/uploads/1792759870324-xew1be.jpg',
];
// [game_id, 区服, 渠道, account_id, 资产对象, 价格, 支持包赔, 描述, 已鉴标识]
const seedListings = [
  // 王者荣耀（sort_order=1，6 条）
  [3, '安卓QQ区', 'QQ区', 'demo_wzry_01', { rank: '星耀100星', noble: 'V8', skins: 89, heroes: 98, key_assets: '荣耀典藏,李白凤求凰' }, 1280, 1, '自用号，典藏皮肤都在，退游出', true],
  [3, '苹果微信区', '微信区', 'demo_wzry_02', { rank: '荣耀王者', noble: 'V10', skins: 156, heroes: 110, key_assets: '荣耀典藏×3,星元全套,全限定' }, 5800, 1, '星元全套，限定齐全，一号一主', true],
  [3, '安卓微信区', '微信区', 'demo_wzry_03', { rank: '钻石', noble: 'V5', skins: 42, heroes: 76, key_assets: '孙悟空至尊宝' }, 380, 0, '入门小资号，英雄皮肤基础齐全', false],
  [3, '安卓QQ区', 'QQ区', 'demo_wzry_04', { rank: '王者50星', noble: 'V9', skins: 120, heroes: 105, key_assets: '武则天倪克斯,全英雄' }, 2680, 1, '武则天在，英雄全收集，可验号', true],
  [3, '苹果QQ区', 'QQ区', 'demo_wzry_05', { rank: '最强王者', noble: 'V7', skins: 75, heroes: 92, key_assets: '韩信白虎吟' }, 880, 1, '韩信白皮，段位高可带打', false],
  [3, '安卓QQ区', 'QQ区', 'demo_wzry_06', { rank: '荣耀王者', noble: 'V10', skins: 203, heroes: 114, key_assets: '典藏全套,星元全套,全限定' }, 8800, 1, '满配天花板号，收藏党首选', true],
  // 和平精英（sort_order=2，4 条）
  [4, '安卓QQ区', 'QQ区', 'demo_hpjy_01', { rank: '英雄黄金', level: 45, skins: 98, vehicles: '7级车', key_assets: '玛莎拉蒂' }, 680, 1, '玛莎拉蒂在，时装近百', false],
  [4, '微信区', '微信区', 'demo_hpjy_02', { rank: '无敌战神', level: 60, skins: 260, vehicles: '8级车,粉装套', key_assets: '玛莎拉蒂,粉装全套' }, 3200, 1, '战神段位粉装全套，顶级号', true],
  [4, '苹果QQ区', 'QQ区', 'demo_hpjy_03', { rank: '钻石', level: 38, skins: 55, vehicles: '6级车', key_assets: '特斯拉' }, 260, 0, '低配娱乐号，价格实在', false],
  [4, '安卓QQ区', 'QQ区', 'demo_hpjy_04', { rank: '战神', level: 52, skins: 140, vehicles: '7级车', key_assets: '兰博基尼' }, 1580, 1, '兰博基尼+战神框，收藏实用两相宜', true],
  // 三角洲行动（sort_order=3，3 条）
  [12, 'PC端', '官服', 'demo_sjz_01', { rank: '上校', skins: 48, heroes: 12, key_assets: '红名全套,M7改装件' }, 1200, 1, '红名装备齐全，改枪满配', false],
  [12, '安卓端', '官服', 'demo_sjz_02', { rank: '大尉', skins: 22, heroes: 8, key_assets: 'AWM色差' }, 450, 1, '有色差AWM，新手过渡号', false],
  [12, 'PC端', '官服', 'demo_sjz_03', { rank: '大校', skins: 65, heroes: 14, key_assets: '海鹰全套,KC17龙鳞' }, 2800, 1, '海鹰全套高战号，可验仓库', true],
  // 无畏契约（sort_order=4，3 条）
  [11, '全平台', '官服', 'demo_wwqy_01', { rank: '赋能', skins: 68, heroes: 16, key_assets: '冠军套,KAI套,大刀' }, 2100, 1, '冠军套赋能号，皮肤质量高', true],
  [11, '电信一区', '官服', 'demo_wwqy_02', { rank: '不朽', skins: 41, heroes: 15, key_assets: '紫金套,裂击' }, 890, 1, '紫金套在，英雄全解锁', false],
  [11, '全平台', '官服', 'demo_wwqy_03', { rank: '超凡', skins: 18, heroes: 12, key_assets: '亚拉axxis' }, 320, 0, '入门皮肤号，手感好', false],
  // 原神（sort_order=6，3 条）
  [1, '官服-天空岛', '官服', 'demo_yx_01', { level: 60, chars: 72, lights: 9, key_assets: '那维莱特C2,钟离全套' }, 1800, 1, '60级满探索，主C配置齐', true],
  [1, 'B服-蒲公英', '渠道服', 'demo_yx_02', { level: 45, chars: 38, lights: 3, key_assets: '胡桃C1,护摩之杖' }, 550, 0, 'B服小资号，胡桃护摩在', false],
  [1, '官服-世界树', '官服', 'demo_yx_03', { level: 60, chars: 85, lights: 21, key_assets: '纳西妲满C6,天空岛全套,全五星' }, 4600, 1, '接近全五星收藏号，武器池深', true],
  // 崩坏：星穹铁道（sort_order=10，2 条）
  [2, '官服-天穹市', '官服', 'demo_xqtd_01', { rank: '账号70级', skins: 12, heroes: 34, key_assets: '黄泉E2,流萤E0' }, 2400, 1, '黄泉E2高配，深渊满星', true],
  [2, 'B服-黑塔', '渠道服', 'demo_xqtd_02', { rank: '账号65级', skins: 8, heroes: 28, key_assets: '镜流E0,刃' }, 720, 0, 'B服成品号，主流C都有', false],
  // 火影忍者（sort_order=7，2 条）
  [16, 'QQ区', 'QQ区', 'demo_hy_01', { rank: '影级', skins: 26, heroes: 48, key_assets: '斑[白面具],六道鸣人' }, 1100, 1, '白面具斑在，忍者池深', false],
  [16, '微信区', '微信区', 'demo_hy_02', { rank: '上忍', skins: 12, heroes: 30, key_assets: '卡卡西[万花筒]' }, 350, 0, '万花筒卡卡西，休闲号', false],
  // 鸣潮（sort_order=8，2 条）
  [17, '官服', '官服', 'demo_mc_01', { rank: '账号60级', skins: 6, heroes: 24, key_assets: '忌炎C2,吟霖C1' }, 1650, 1, '忌炎C2成品，声骸毕业部分', true],
  [17, 'B服', '渠道服', 'demo_mc_02', { rank: '账号50级', skins: 3, heroes: 16, key_assets: '椿' }, 480, 0, 'B服小号，椿在', false],
  // 暗区突围（sort_order=11，2 条）
  [19, '微信区', '微信区', 'demo_aq_01', { rank: '暗区传说', skins: 42, heroes: 9, key_assets: '红卡全套,AW满改' }, 980, 1, '仓库价值高，AW满改', false],
  [19, 'QQ区', 'QQ区', 'demo_aq_02', { rank: '精英', skins: 18, heroes: 6, key_assets: 'M4满改' }, 290, 0, '起步号，改件齐全', false],
  // 英雄联盟（sort_order 靠后，2 条）
  [9, '艾欧尼亚', '官服', 'demo_lol_01', { rank: '王者', skins: 186, heroes: 160, key_assets: '全英雄,至臻艾希,青花瓷妮蔻' }, 1350, 1, '艾欧尼亚王者号，至臻皮肤在', true],
  [9, '德玛西亚', '官服', 'demo_lol_02', { rank: '大师', skins: 64, heroes: 120, key_assets: '龙魂水晶' }, 260, 0, '大师段位，皮肤中等', false],
  // 地下城与勇士（2 条）
  [8, '跨五-浙江一区', '官服', 'demo_dnf_01', { rank: '重泉100级', skins: 15, heroes: 12, key_assets: '+17晨光,年套Avatar全套' }, 3600, 1, '+17晨光武器，年套齐，可验装备栏', true],
  [8, '跨一-广东一区', '官服', 'demo_dnf_02', { rank: '重泉70级', skins: 6, heroes: 5, key_assets: '+12十字斩刀' }, 850, 0, '小号胚子，武器+12', false],
  // 梦幻西游（2 条）
  [6, '紫禁城', '官服', 'demo_mhxy_01', { rank: '175级大唐官府', skins: 8, heroes: 6, key_assets: '全红珍品武器,化生寺全套,精灵孟极' }, 6800, 1, '175高端号，珍品装备在，价值可验', true],
  [6, '青花瓷', '官服', 'demo_mhxy_02', { rank: '109级方寸山', skins: 4, heroes: 3, key_assets: '珍品剑,精灵白泽' }, 1500, 1, '109任务号，白泽在', false],
];

const DAY_MS = 86_400_000;
const insListingSeed = db.prepare(`INSERT INTO listings (seller_id, game_id, server_name, channel, account_id, assets_json, raw_images_json, gen_images_json,
  price, support_compensation, description, status, verified_until, listed_at, created_at, updated_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,?, 'on', ?,?,?,?
  WHERE NOT EXISTS (SELECT 1 FROM listings WHERE account_id=?)`);
const seedValuedIds = []; // 本次新插入的商品 id，稍后触发估值
seedListings.forEach((s, i) => {
  const [gameId, server, channel, accountId, assets, price, comp, desc, verified] = s;
  const listedAt = now - (i % 14 + 1) * DAY_MS - (i * 37 % 20) * 3_600_000; // 上架时间错开近两周
  const rawImgs = [SEED_IMGS[i % 6], SEED_IMGS[(i + 1) % 6], SEED_IMGS[(i + 2) % 6]]; // 3 张真实存在的演示截图
  const r = insListingSeed.run(
    SEED_SELLERS[i % SEED_SELLERS.length], gameId, server, channel, accountId,
    JSON.stringify(assets), JSON.stringify(rawImgs), '[]',
    price, comp, desc,
    verified ? now + 30 * DAY_MS : 0,
    listedAt, listedAt, listedAt,
    accountId,
  );
  if (r.changes > 0) seedValuedIds.push(Number(r.lastInsertRowid));
});
if (seedValuedIds.length) {
  // 沿用审核通过后的估值流程：动态导入避免与 valuation.js 循环依赖；无 LLM Key 时自动规则兜底
  import('./engine/valuation.js').then(({ valueListing }) => {
    for (const id of seedValuedIds) valueListing(id).catch(() => {});
  }).catch(() => {});
}
