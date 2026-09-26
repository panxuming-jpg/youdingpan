/**
 * 平台适配器基类。
 *
 * 真实采集模式：子类 override fetchReal(games, now)，用 collector.openPage 拦各平台
 * 列表页 XHR 或取 DOM 渲染结果，返回标准商品数组即可无缝替换。
 * 模拟兜底：fetchReal 返回空或抛错时，退回 fetchMocked 演示逻辑，保证链路不中断。
 */
import { dbPrepare } from './dbproxy.js';

export class BaseAdapter {
  constructor(config) {
    this.platform = config.platform;
    this.name = config.name;
    this.intervalMs = config.intervalMs;       // 采集频率（真实模式 3600000ms = 1h）
    this.priceBias = config.priceBias ?? 1;      // 模拟兜底用：平台价格倾向
    this.gameFilter = config.gameFilter ?? (() => true); // 模拟兜底用：游戏过滤
    this.tagBias = config.tagBias ?? [];
    // 真实平台（7881/盼之）：不 seed、不随机造数；抓取失败时仅回放池内已采集的真实商品
    this.realMode = config.realMode ?? false;
    this.pool = new Map();                       // 模拟兜底用：远端商品池
    this.seq = Math.floor(Math.random() * 100000);
  }

  nextId() {
    this.seq += 1;
    return `${this.platform.toUpperCase().replace(/\W/g, '')}-${this.seq}`;
  }

  /**
   * 取该平台可采集的游戏及其平台游戏码（从 platform_game_codes 表）。
   * 真实采集器据此构造各平台列表页 URL。
   * 返回: [{ id, name, short, category, tags, platformGameCode, bizProd, note, servers }]
   */
  loadGames() {
    const rows = dbPrepare(`
      SELECT g.id, g.name, g.short_name AS short, g.category, g.tags,
             p.platform_game_code, p.biz_prod, p.note
      FROM games g
      JOIN platform_game_codes p ON p.game_id = g.id
      WHERE g.status = 1 AND p.platform = ? AND p.enabled = 1
    `).all(this.platform);
    return rows.map(g => ({
      id: g.id,
      name: g.name,
      short: g.short,
      category: g.category,
      tags: JSON.parse(g.tags || '[]'),
      platformGameCode: g.platform_game_code,
      bizProd: g.biz_prod,
      note: g.note,
      servers: dbPrepare('SELECT name, type FROM game_servers WHERE game_id=?').all(g.id),
    }));
  }

  buildItem(game, server, now) {
    const id = this.nextId();
    const base = basePrice(game.id);
    const price = Math.max(20, Math.round(base * this.priceBias * (0.75 + Math.random() * 0.5)));
    const tags = pickTags(this.tagBias, server.type);
    return {
      platform_item_id: id,
      game_id: game.id,
      server_name: server.name,
      title: buildTitle(game, server, tags),
      description: buildDescription(game, server, tags),
      price,
      original_price: price,
      tags,
      images: ['验证图1', '验证图2', '角色面板'],
      seller: randomSeller(),
      publish_time: now,
    };
  }

  seed(now) {
    // 真实平台不预置模拟商品
    if (this.realMode) return;
    const games = this.loadGames();
    const count = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const game = games[Math.floor(Math.random() * games.length)];
      if (!game || !game.servers?.length) continue;
      const server = game.servers[Math.floor(Math.random() * game.servers.length)];
      const item = this.buildItem(game, server, now - Math.floor(Math.random() * 3 * 86_400_000));
      this.pool.set(item.platform_item_id, item);
    }
  }

  /** 重启后从数据库恢复在售商品到模拟兜底池（仅真实采集未覆盖时用） */
  rehydrate(now) {
    const rows = dbPrepare(`SELECT * FROM goods WHERE platform=? AND status='on' ORDER BY last_seen DESC LIMIT 60`).all(this.platform);
    for (const g of rows) {
      if (this.pool.has(g.platform_item_id)) continue;
      this.pool.set(g.platform_item_id, {
        platform_item_id: g.platform_item_id,
        game_id: g.game_id,
        server_name: g.server_name,
        title: g.title,
        description: g.description,
        price: g.price,
        original_price: g.original_price,
        tags: JSON.parse(g.tags || '[]'),
        images: JSON.parse(g.images || '[]'),
        seller: g.seller,
        publish_time: g.publish_time || now,
      });
    }
  }

  /**
   * 真实采集：子类 override 实现。返回标准商品数组。
   * 默认返回 null = "未实现真实采集"（BaseAdapter 无声退回 fetchMocked）。
   * 子类显式返回 [] = "已实现但本轮无数据"（会打印警告）。
   * @param {Array} games loadGames() 返回的游戏列表（含 platformGameCode）
   * @param {number} now 本轮采集时间戳
   * @returns {Promise<Array|null>}
   */
  async fetchReal(games, now) {
    return null;
  }

  /**
   * 单次采集：优先真实采集；realMode 下不退回任何模拟兜底，保证展示数据全是真实抓取的。
   */
  async fetch(now) {
    const games = this.loadGames();
    if (!games.length) {
      // 平台没有游戏码映射：realMode 跳过；模拟兜底（已下线）也跳过
      return [];
    }
    try {
      const items = await this.fetchReal(games, now);
      if (items === null) {
        // 子类未实现真实采集：realMode 视为"无数据"，不退回模拟兜底
        return this.realMode ? [] : this.fetchMocked(now, games);
      }
      return items || [];
    } catch (err) {
      console.error(`[adapter:${this.platform}] fetchReal 异常: ${err.message}`);
      // realMode 下异常也返回空，绝不退回模拟兜底
      return this.realMode ? [] : this.fetchMocked(now, games);
    }
  }

  /** 模拟兜底（仅演示用）：realMode 下永不调用，保留给历史模拟兜底适配器；现已无此类适配器 */
  fetchMocked(now, games) {
    // realMode 下绝不回放、不造数
    if (this.realMode) {
      return [];
    }
    if (!games) games = this.loadGames();
    // 兼容旧 loadGames 形态（无 platformGameCode 字段时也能跑）
    const mockGames = games.length ? games : this.loadMockGames();
    const snapshot = [];
    for (const item of this.pool.values()) {
      if (Math.random() < 0.18) {
        const drift = 1 + (Math.random() - 0.62) * 0.06;
        item.price = Math.max(20, Math.round(item.price * drift));
        if (!item.publish_time) item.publish_time = now;
      }
      snapshot.push({ ...item });
    }
    if (mockGames.length && Math.random() < 0.45) {
      const game = mockGames[Math.floor(Math.random() * mockGames.length)];
      if (game && game.servers?.length) {
        const server = game.servers[Math.floor(Math.random() * game.servers.length)];
        const item = this.buildItem(game, server, now);
        this.pool.set(item.platform_item_id, item);
        snapshot.push({ ...item });
      }
    }
    if (this.pool.size > 6 && Math.random() < 0.12) {
      const keys = [...this.pool.keys()];
      this.pool.delete(keys[Math.floor(Math.random() * keys.length)]);
    }
    return snapshot;
  }

  /** 旧版游戏库查询（兼容模拟兜底：从 games 全表 + game_filter 过滤） */
  loadMockGames() {
    const rows = dbPrepare(`SELECT g.id, g.name, g.short_name AS short, g.category, g.tags FROM games g WHERE g.status=1`).all();
    let parsed;
    try { parsed = rows.map(g => ({ ...g, tags: JSON.parse(g.tags || '[]') })); } catch { parsed = rows; }
    return parsed
      .filter(g => this.gameFilter(g))
      .map(g => ({ ...g, servers: dbPrepare('SELECT name, type FROM game_servers WHERE game_id=?').all(g.id) }))
      .filter(g => g.servers.length);
  }
}

// ---------- 模拟数据工具（仅演示用） ----------

function basePrice(gameId) {
  const ranges = [
    [150, 900], [200, 1500], [50, 800], [80, 600], [300, 2000],
    [800, 8000], [500, 5000], [300, 6000], [100, 1200], [200, 2500],
  ];
  const [lo, hi] = ranges[gameId % ranges.length];
  return lo + Math.random() * (hi - lo);
}

function pickTags(bias, serverType) {
  const tags = new Set();
  if (serverType) tags.add(serverType);
  for (const t of bias) if (Math.random() < 0.55) tags.add(t);
  if (Math.random() < 0.5) tags.add('可换绑');
  if (Math.random() < 0.25) tags.add('包赔');
  if (Math.random() < 0.12) tags.add('公示期');
  return [...tags];
}

const ROLE_WORDS = ['满命', '满练度', '极品圣遗物', '多限定', '毕业号', '高练度', '自选双爆', '平民毕业', '稀有皮肤多', '战力榜前百'];
const RARITY = ['5星金卡号', '珍藏账号', '高性价比', '急售', '老号'];

function buildTitle(game, server, tags) {
  const a = ROLE_WORDS[Math.floor(Math.random() * ROLE_WORDS.length)];
  const b = RARITY[Math.floor(Math.random() * RARITY.length)];
  return `${game.short || game.name} ${server.name} ${a}${b}`;
}

function buildDescription(game, server, tags) {
  return `【${game.name}】${server.name} 账号，${tags.join(' / ')}。角色资源丰富，练度详情见验证图。商品信息以平台页面为准，购买前请自行核实。`;
}

function randomSeller() {
  const chars = '天南地北风花雪月星辰大海逍遥游侠龙虎山人行客';
  const n = 2 + Math.floor(Math.random() * 3);
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s + Math.floor(Math.random() * 90 + 10) + '号';
}
