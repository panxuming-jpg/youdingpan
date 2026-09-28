import { Router } from 'express';
import { db, parseJSON, PLATFORMS, getSetting, getSettingNum, isMember } from '../db.js';
import { authOptional, authRequired } from '../middleware.js';
import { maskSeller, relTime } from '../util.js';
import { searchIds } from '../search.js';

const r = Router();
r.use(authOptional);

function shapeGoods(g, uid, withDetail = false) {
  const game = db.prepare('SELECT name, short_name, category FROM games WHERE id=?').get(g.game_id) || {};
  const out = {
    id: g.id,
    platform: g.platform,
    platform_name: PLATFORMS[g.platform] || g.platform,
    game_id: g.game_id,
    game_name: game.short_name || game.name || '',
    server_name: g.server_name,
    title: g.title,
    price: g.price,
    original_price: g.original_price,
    lowest_price: g.lowest_price,
    last_drop: g.last_drop || 0,
    tags: parseJSON(g.tags, []),
    publish_time: g.publish_time,
    publish_time_str: relTime(g.publish_time),
    status: g.status,
    // 列表只带第一张缩略图，完整图集进详情页取
    thumb: parseJSON(g.images, [])[0] || '',
  };
  if (uid) {
    out.is_favorited = !!db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND goods_id=?').get(uid, g.id);
    // 收藏降价监控状态（收藏时自动开启，可在详情页关闭）
    const w = db.prepare('SELECT baseline_price, status FROM fav_price_watch WHERE user_id=? AND goods_id=?').get(uid, g.id);
    out.fav_watch = !!(w && w.status === 'on');
    out.fav_baseline = w ? w.baseline_price : null;
  } else {
    out.is_favorited = false;
  }
  if (withDetail) {
    out.images = parseJSON(g.images, []);
    out.description = g.description;
    out.seller = maskSeller(g.seller);
    out.source_url = g.source_url || '';
    out.price_history = db.prepare('SELECT price, recorded_at FROM price_history WHERE goods_id=? ORDER BY recorded_at').all(g.id);
  }
  return out;
}

r.get('/goods', (req, res) => {
  const { game_id, platforms, price_min, price_max, tags, sort, keyword, favorited } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(1, parseInt(req.query.size) || 20));

  const where = [];
  const params = [];
  if (favorited === '1') {
    if (!req.user) return res.json({ ok: true, data: { total: 0, list: [] } });
    where.push('g.id IN (SELECT goods_id FROM favorites WHERE user_id=?)');
    params.push(req.user.id);
  } else {
    where.push(`g.status='on'`);
  }
  if (game_id) { where.push('g.game_id=?'); params.push(Number(game_id)); }
  if (platforms) {
    // 'all'（全部平台）不参与 SQL 过滤：选择全部平台等同于不加平台限制
    const list = String(platforms).split(',').filter(p => PLATFORMS[p] && p !== 'all');
    if (list.length) { where.push(`g.platform IN (${list.map(() => '?').join(',')})`); params.push(...list); }
  }
  if (price_min !== undefined && price_min !== '') { where.push('g.price>=?'); params.push(Number(price_min)); }
  if (price_max !== undefined && price_max !== '') { where.push('g.price<=?'); params.push(Number(price_max)); }
  if (tags) {
    for (const t of String(tags).split(',').filter(Boolean)) {
      where.push("EXISTS (SELECT 1 FROM json_each(g.tags) WHERE json_each.value=?)");
      params.push(t);
    }
  }
  // 关键词检索：走内存倒排索引（标题+区服分词）。
  // "A B" 形式：同时匹配 A 和 B 的商品（match_level=2）优先透出，
  // 再透出只匹配其一的商品（match_level=1），同级内按用户选择的排序键。
  let levelCase = '';
  if (keyword) {
    const { ids, levelOf } = searchIds(keyword);
    if (!ids.length) return res.json({ ok: true, data: { total: 0, list: [] } });
    where.push(`g.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
    levelCase = `CASE g.id ${[...levelOf.entries()].map(([id, lv]) => `WHEN ${Number(id)} THEN ${lv}`).join(' ')} ELSE 0 END`;
  }

  let order = 'g.publish_time DESC';
  if (sort === 'lowest') order = 'g.price ASC, g.publish_time DESC';
  else if (sort === 'drop') order = '(g.last_drop > 0) DESC, g.last_drop DESC, g.publish_time DESC';
  if (levelCase) order = `${levelCase} DESC, ${order}`;

  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM goods g ${whereSql}`).get(...params).c;

  // 免费用户列表限额：仅会员/管理员放行，游客和非会员都只返回前 free_view_limit 条
  const uid = req.user?.id;
  const member = (req.user && req.user.is_admin) || (uid && isMember(uid));
  let cappedTotal = total;
  let locked = false;
  if (!member) {
    const limit = getSettingNum('free_view_limit', 10);
    if (total > limit) {
      cappedTotal = limit;
      locked = true;
    }
  }
  // 限制后只取前 cappedTotal 条（非会员不分页）
  const effectiveSize = member ? size : Math.min(size, cappedTotal);
  const effectiveOffset = member ? (page - 1) * size : 0;
  const rows = db.prepare(`SELECT g.* FROM goods g ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, effectiveSize, effectiveOffset);

  res.json({ ok: true, data: { total, list: rows.map(g => shapeGoods(g, req.user?.id)), locked, free_view_limit: locked ? getSettingNum('free_view_limit', 10) : null } });
});

r.get('/goods/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM goods WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '商品不存在或已下架' });
  // 列表限额模式下，详情页不再做单独计数锁定，能进入列表的商品均可查看完整详情
  res.json({ ok: true, data: shapeGoods(g, req.user?.id, true) });
});

r.get('/goods/:id/history', (req, res) => {
  const days = [7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = Date.now() - days * 86_400_000;
  const list = db.prepare('SELECT price, recorded_at FROM price_history WHERE goods_id=? AND recorded_at>=? ORDER BY recorded_at')
    .all(Number(req.params.id), since);
  res.json({ ok: true, data: list });
});

// 收藏即开启降价监控：以收藏时价格为基线，低于基线 / 下架时提醒（push.js dispatchFavEvent）
r.post('/favorites/:goodsId/toggle', authRequired, (req, res) => {
  const gid = Number(req.params.goodsId);
  const exist = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND goods_id=?').get(req.user.id, gid);
  if (exist) {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND goods_id=?').run(req.user.id, gid);
    db.prepare('DELETE FROM fav_price_watch WHERE user_id=? AND goods_id=?').run(req.user.id, gid);
    return res.json({ ok: true, data: { favorited: false } });
  }
  const g = db.prepare('SELECT price FROM goods WHERE id=?').get(gid);
  if (!g) return res.json({ ok: false, error: '商品不存在或已下架' });
  db.prepare('INSERT INTO favorites (user_id, goods_id, created_at) VALUES (?,?,?)').run(req.user.id, gid, Date.now());
  db.prepare(`INSERT INTO fav_price_watch (user_id, goods_id, baseline_price, status, created_at) VALUES (?,?,?,'on',?)
    ON CONFLICT(user_id, goods_id) DO UPDATE SET status='on', baseline_price=excluded.baseline_price`)
    .run(req.user.id, gid, g.price, Date.now());
  res.json({ ok: true, data: { favorited: true, fav_watch: true, fav_baseline: g.price } });
});

// 收藏列表（含降价监控状态，供"我的收藏"页展示）
r.get('/favorites', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT f.goods_id, f.created_at AS fav_at,
      w.status AS watch_status, w.baseline_price
    FROM favorites f
    LEFT JOIN fav_price_watch w ON w.user_id=f.user_id AND w.goods_id=f.goods_id
    WHERE f.user_id=? ORDER BY f.created_at DESC`).all(req.user.id);
  res.json({ ok: true, data: rows.map(x => ({
    goods_id: x.goods_id,
    fav_at: x.fav_at,
    fav_watch: x.watch_status === 'on',
    fav_baseline: x.baseline_price ?? null,
  })) });
});

// 开关单个收藏商品的降价监控；重新开启时以当前价重置基线
r.put('/favorites/:goodsId/watch', authRequired, (req, res) => {
  const gid = Number(req.params.goodsId);
  const fav = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND goods_id=?').get(req.user.id, gid);
  if (!fav) return res.json({ ok: false, error: '请先收藏该商品' });
  const g = db.prepare('SELECT price FROM goods WHERE id=?').get(gid);
  if (!g) return res.json({ ok: false, error: '商品不存在或已下架' });
  const on = req.body?.on !== false;
  if (on) {
    db.prepare(`INSERT INTO fav_price_watch (user_id, goods_id, baseline_price, status, created_at) VALUES (?,?,?,'on',?)
      ON CONFLICT(user_id, goods_id) DO UPDATE SET status='on',
        baseline_price=CASE WHEN fav_price_watch.status='off' THEN excluded.baseline_price ELSE fav_price_watch.baseline_price END`)
      .run(req.user.id, gid, g.price, Date.now());
  } else {
    db.prepare(`UPDATE fav_price_watch SET status='off' WHERE user_id=? AND goods_id=?`).run(req.user.id, gid);
  }
  const w = db.prepare('SELECT baseline_price FROM fav_price_watch WHERE user_id=? AND goods_id=?').get(req.user.id, gid);
  res.json({ ok: true, data: { fav_watch: on, fav_baseline: w ? w.baseline_price : null } });
});

r.get('/announcements', (_req, res) => {
  const list = db.prepare('SELECT id, title, content, created_at FROM announcements ORDER BY created_at DESC LIMIT 10').all();
  res.json({ ok: true, data: list });
});

export default r;
