import { Router } from 'express';
import { db, PLATFORMS } from '../db.js';
import { adminRequired } from '../middleware.js';
import { shapeGame } from './games.js';

const r = Router();
r.use('/admin', adminRequired);

r.get('/admin/overview', (_req, res) => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const platforms = db.prepare('SELECT * FROM platform_status').all().map(p => ({
    platform: p.platform,
    name: p.name || PLATFORMS[p.platform],
    status: p.status,
    running: !!p.running,
    last_run: p.last_run,
    total_ok: p.total_ok,
    last_ok: db.prepare('SELECT ok_count FROM crawl_logs WHERE platform=? ORDER BY created_at DESC LIMIT 1').get(p.platform)?.ok_count ?? 0,
    last_fail: db.prepare('SELECT fail_count FROM crawl_logs WHERE platform=? ORDER BY created_at DESC LIMIT 1').get(p.platform)?.fail_count ?? 0,
  }));
  res.json({
    ok: true,
    data: {
      goods_total: db.prepare(`SELECT COUNT(*) AS c FROM goods WHERE status='on'`).get().c,
      tasks_online: db.prepare(`SELECT COUNT(*) AS c FROM monitor_tasks WHERE status='on'`).get().c,
      triggers_today: db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE created_at>=?').get(todayStart.getTime()).c,
      users_total: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      platforms,
      recent_logs: db.prepare('SELECT id, platform, ok_count, fail_count, message, created_at FROM crawl_logs ORDER BY created_at DESC LIMIT 20').all(),
    },
  });
});

r.get('/admin/logs', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = 20;
  const where = [];
  const params = [];
  if (req.query.platform && PLATFORMS[req.query.platform]) { where.push('platform=?'); params.push(req.query.platform); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM crawl_logs ${whereSql}`).get(...params).c;
  const list = db.prepare(`SELECT * FROM crawl_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size);
  res.json({ ok: true, data: { total, list } });
});

r.post('/admin/platform/:platform/toggle', (req, res) => {
  const p = db.prepare('SELECT * FROM platform_status WHERE platform=?').get(req.params.platform);
  if (!p) return res.json({ ok: false, error: '平台不存在' });
  const running = req.body?.running ? 1 : 0;
  db.prepare('UPDATE platform_status SET running=? WHERE platform=?').run(running, p.platform);
  res.json({ ok: true, data: { platform: p.platform, running: !!running } });
});

r.get('/admin/games', (_req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY sort_order, id').all();
  res.json({ ok: true, data: rows.map(g => shapeGame(g)) });
});

r.post('/admin/games', (req, res) => {
  const { name, short_name, pinyin, tags, category } = req.body || {};
  if (!name?.trim()) return res.json({ ok: false, error: '游戏名称不能为空' });
  const exist = db.prepare('SELECT id FROM games WHERE name=?').get(name.trim());
  if (exist) return res.json({ ok: false, error: '游戏已存在' });
  const ins = db.prepare('INSERT INTO games (name, short_name, pinyin, tags, category, status, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(name.trim(), (short_name || name).trim(), pinyin || '', JSON.stringify(Array.isArray(tags) ? tags : []), category || '手游', Date.now());
  res.json({ ok: true, data: shapeGame(db.prepare('SELECT * FROM games WHERE id=?').get(ins.lastInsertRowid)) });
});

r.put('/admin/games/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '游戏不存在' });
  const b = req.body || {};
  const name = b.name?.trim() || g.name;
  const short_name = b.short_name?.trim() || g.short_name;
  const pinyin = b.pinyin ?? g.pinyin;
  const tags = JSON.stringify(Array.isArray(b.tags) ? b.tags : JSON.parse(g.tags));
  const category = b.category || g.category;
  const status = b.status !== undefined ? (b.status ? 1 : 0) : g.status;
  db.prepare('UPDATE games SET name=?, short_name=?, pinyin=?, tags=?, category=?, status=? WHERE id=?')
    .run(name, short_name, pinyin, tags, category, status, g.id);
  res.json({ ok: true, data: shapeGame(db.prepare('SELECT * FROM games WHERE id=?').get(g.id)) });
});

r.delete('/admin/games/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '游戏不存在' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM goods WHERE game_id=?').get(g.id).c;
  if (used > 0) return res.json({ ok: false, error: `该游戏下有 ${used} 个商品，无法删除（可停用）` });
  db.prepare('DELETE FROM games WHERE id=?').run(g.id);
  db.prepare('DELETE FROM game_servers WHERE game_id=?').run(g.id);
  res.json({ ok: true, data: { ok: true } });
});

r.post('/admin/games/:id/servers', (req, res) => {
  const g = db.prepare('SELECT id FROM games WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '游戏不存在' });
  const { name, type } = req.body || {};
  if (!name?.trim()) return res.json({ ok: false, error: '区服名称不能为空' });
  const ins = db.prepare('INSERT INTO game_servers (game_id, name, type) VALUES (?,?,?)').run(g.id, name.trim(), type || '官服');
  res.json({ ok: true, data: db.prepare('SELECT * FROM game_servers WHERE id=?').get(ins.lastInsertRowid) });
});

r.delete('/admin/servers/:id', (req, res) => {
  db.prepare('DELETE FROM game_servers WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true, data: { ok: true } });
});

r.get('/admin/announcements', (_req, res) => {
  res.json({ ok: true, data: db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all() });
});

r.post('/admin/announcements', (req, res) => {
  const { title, content } = req.body || {};
  if (!title?.trim()) return res.json({ ok: false, error: '标题不能为空' });
  const ins = db.prepare('INSERT INTO announcements (title, content, created_at) VALUES (?,?,?)')
    .run(title.trim(), content || '', Date.now());
  res.json({ ok: true, data: db.prepare('SELECT * FROM announcements WHERE id=?').get(ins.lastInsertRowid) });
});

r.delete('/admin/announcements/:id', (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true, data: { ok: true } });
});

export default r;
