import { Router } from 'express';
import { db, parseJSON, PLATFORMS } from '../db.js';
import { authRequired } from '../middleware.js';

const r = Router();
r.use('/tasks', authRequired);

const TASK_TYPES = ['new', 'drop', 'off'];
const CHANNELS = ['inapp', 'wechat', 'email'];

function shapeTask(t) {
  const game = db.prepare('SELECT name, short_name FROM games WHERE id=?').get(t.game_id) || {};
  const server = t.server_id ? db.prepare('SELECT name FROM game_servers WHERE id=?').get(t.server_id) : null;
  return {
    id: t.id,
    name: t.name,
    game_id: t.game_id,
    game_name: game.short_name || game.name || '',
    platforms: parseJSON(t.platforms, []),
    server_id: t.server_id,
    server_name: server ? server.name : null,
    price_min: t.price_min,
    price_max: t.price_max,
    keywords: t.keywords || '',
    notify_types: parseJSON(t.notify_types, []),
    drop_threshold: t.drop_threshold,
    channels: parseJSON(t.channels, ['inapp']),
    status: t.status,
    trigger_count: t.trigger_count,
    created_at: t.created_at,
  };
}

function validate(body) {
  const { name, game_id, platforms, notify_types } = body || {};
  if (!name || !String(name).trim()) return '任务名称不能为空';
  const game = db.prepare('SELECT id FROM games WHERE id=? AND status=1').get(Number(game_id));
  if (!game) return '请选择监控游戏';
  if (!Array.isArray(platforms) || !platforms.length || platforms.some(p => !PLATFORMS[p])) return '请选择监控平台';
  if (!Array.isArray(notify_types) || !notify_types.length || notify_types.some(t => !TASK_TYPES.includes(t))) return '请选择监控类型';
  return null;
}

function clean(body) {
  const channels = Array.isArray(body.channels) ? body.channels.filter(c => CHANNELS.includes(c)) : [];
  return {
    name: String(body.name).trim().slice(0, 30),
    game_id: Number(body.game_id),
    platforms: JSON.stringify(body.platforms),
    server_id: body.server_id ? Number(body.server_id) : null,
    price_min: body.price_min === '' || body.price_min == null ? null : Number(body.price_min),
    price_max: body.price_max === '' || body.price_max == null ? null : Number(body.price_max),
    // 关键词规整：压缩空白、空格分隔、限长，空串表示不过滤
    keywords: String(body.keywords || '').split(/\s+/).filter(Boolean).join(' ').slice(0, 100),
    notify_types: JSON.stringify(body.notify_types),
    drop_threshold: body.drop_threshold != null && body.drop_threshold !== '' ? Number(body.drop_threshold) : 0,
    channels: JSON.stringify(channels.length ? channels : ['inapp']),
    status: body.status === 'off' ? 'off' : 'on',
  };
}

r.get('/tasks', (req, res) => {
  const rows = db.prepare('SELECT * FROM monitor_tasks WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ ok: true, data: rows.map(shapeTask) });
});

r.post('/tasks', (req, res) => {
  const err = validate(req.body);
  if (err) return res.json({ ok: false, error: err });
  const c = clean(req.body);
  const ins = db.prepare(`INSERT INTO monitor_tasks
    (user_id, name, game_id, platforms, server_id, price_min, price_max, keywords, notify_types, drop_threshold, channels, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, c.name, c.game_id, c.platforms, c.server_id, c.price_min, c.price_max, c.keywords, c.notify_types, c.drop_threshold, c.channels, c.status, Date.now());
  res.json({ ok: true, data: shapeTask(db.prepare('SELECT * FROM monitor_tasks WHERE id=?').get(ins.lastInsertRowid)) });
});

function owned(req) {
  return db.prepare('SELECT * FROM monitor_tasks WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
}

r.put('/tasks/:id', (req, res) => {
  const t = owned(req);
  if (!t) return res.json({ ok: false, error: '任务不存在' });
  const err = validate(req.body);
  if (err) return res.json({ ok: false, error: err });
  const c = clean(req.body);
  db.prepare(`UPDATE monitor_tasks SET name=?, game_id=?, platforms=?, server_id=?, price_min=?, price_max=?,
    keywords=?, notify_types=?, drop_threshold=?, channels=?, status=? WHERE id=?`)
    .run(c.name, c.game_id, c.platforms, c.server_id, c.price_min, c.price_max, c.keywords, c.notify_types, c.drop_threshold, c.channels, c.status, t.id);
  res.json({ ok: true, data: shapeTask(db.prepare('SELECT * FROM monitor_tasks WHERE id=?').get(t.id)) });
});

r.put('/tasks/:id/status', (req, res) => {
  const t = owned(req);
  if (!t) return res.json({ ok: false, error: '任务不存在' });
  const status = req.body?.status === 'off' ? 'off' : 'on';
  db.prepare('UPDATE monitor_tasks SET status=? WHERE id=?').run(status, t.id);
  res.json({ ok: true, data: { status } });
});

r.delete('/tasks/:id', (req, res) => {
  const t = owned(req);
  if (!t) return res.json({ ok: false, error: '任务不存在' });
  db.prepare('DELETE FROM monitor_tasks WHERE id=?').run(t.id);
  res.json({ ok: true, data: { ok: true } });
});

export default r;
