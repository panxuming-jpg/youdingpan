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
  ];
  for (const [p, n] of plats) ins.run(p, n, 1, 'normal', null, 0);
}
// 老库清理：禁用已下线的模拟兜底平台（藏宝阁/5173），让其不再被引擎调度
db.prepare(`UPDATE platform_status SET running=0 WHERE platform IN ('cangbaoge','5173')`).run();

// 修正游戏短名：无畏契约的旧短名"瓦罗兰特"统一为官方游戏名"无畏契约"
db.prepare(`UPDATE games SET short_name='无畏契约' WHERE name='无畏契约' AND short_name='瓦罗兰特'`).run();

// 老库清理：删除所有模拟兜底商品（需求4：只保留真实抓取的数据）
// - 藏宝阁/5173 平台所有商品（已下线平台）
// - 模拟商品 id 含 '-'（如 7881-xxx / PANZHI-xxx / JIAOYIMAO-xxx / CANGBAOGE-xxx 等）
db.prepare(`DELETE FROM goods WHERE platform IN ('cangbaoge','5173')`).run();
db.prepare(`DELETE FROM goods WHERE platform_item_id LIKE '%-%'`).run();
// 同步清理孤立的价格历史和收藏
db.prepare(`DELETE FROM price_history WHERE goods_id NOT IN (SELECT id FROM goods)`).run();
db.prepare(`DELETE FROM favorites WHERE goods_id NOT IN (SELECT id FROM goods)`).run();

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

export const PLATFORMS = {
  jiaoyimao: '交易猫',
  panzhi: '盼之代售',
  pangxie: '螃蟹账号',
  7881: '7881',
};

export function parseJSON(v, dflt) {
  if (v === null || v === undefined) return dflt;
  try { const r = JSON.parse(v); return r ?? dflt; } catch { return dflt; }
}
