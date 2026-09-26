import { Router } from 'express';
import { db, parseJSON, PLATFORMS } from '../db.js';
import { authOptional, authRequired } from '../middleware.js';
import { maskSeller, relTime } from '../util.js';

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
    const list = String(platforms).split(',').filter(p => PLATFORMS[p]);
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
  if (keyword) { where.push('(g.title LIKE ? OR g.server_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }

  let order = 'g.publish_time DESC';
  if (sort === 'lowest') order = 'g.price ASC, g.publish_time DESC';
  else if (sort === 'drop') order = '(g.last_drop > 0) DESC, g.last_drop DESC, g.publish_time DESC';

  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM goods g ${whereSql}`).get(...params).c;
  const rows = db.prepare(`SELECT g.* FROM goods g ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size);

  res.json({ ok: true, data: { total, list: rows.map(g => shapeGoods(g, req.user?.id)) } });
});

r.get('/goods/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM goods WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '商品不存在或已下架' });
  res.json({ ok: true, data: shapeGoods(g, req.user?.id, true) });
});

r.get('/goods/:id/history', (req, res) => {
  const days = [7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = Date.now() - days * 86_400_000;
  const list = db.prepare('SELECT price, recorded_at FROM price_history WHERE goods_id=? AND recorded_at>=? ORDER BY recorded_at')
    .all(Number(req.params.id), since);
  res.json({ ok: true, data: list });
});

r.post('/favorites/:goodsId/toggle', authRequired, (req, res) => {
  const gid = Number(req.params.goodsId);
  const exist = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND goods_id=?').get(req.user.id, gid);
  if (exist) {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND goods_id=?').run(req.user.id, gid);
    return res.json({ ok: true, data: { favorited: false } });
  }
  db.prepare('INSERT INTO favorites (user_id, goods_id, created_at) VALUES (?,?,?)').run(req.user.id, gid, Date.now());
  res.json({ ok: true, data: { favorited: true } });
});

r.get('/announcements', (_req, res) => {
  const list = db.prepare('SELECT id, title, content, created_at FROM announcements ORDER BY created_at DESC LIMIT 10').all();
  res.json({ ok: true, data: list });
});

export default r;
