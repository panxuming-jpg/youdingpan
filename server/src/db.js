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
