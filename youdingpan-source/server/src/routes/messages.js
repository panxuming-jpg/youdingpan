import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../middleware.js';
import { relTime } from '../util.js';

const r = Router();
r.use('/messages', authRequired);

const TYPE_LABEL = { new: '新上架', drop: '降价', off: '已下架', system: '系统' };

r.get('/messages', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(1, parseInt(req.query.size) || 20));
  const type = req.query.type;
  const where = ['user_id=?'];
  const params = [req.user.id];
  if (type && TYPE_LABEL[type]) { where.push('type=?'); params.push(type); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM notifications ${whereSql}`).get(...params).c;
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  const rows = db.prepare(`SELECT * FROM notifications ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size);
  res.json({
    ok: true,
    data: {
      total, unread,
      list: rows.map(n => ({
        id: n.id, type: n.type, type_label: TYPE_LABEL[n.type] || '通知',
        title: n.title, content: n.content, is_read: !!n.is_read,
        created_at: n.created_at, time_str: relTime(n.created_at), goods_id: n.goods_id,
      })),
    },
  });
});

r.put('/messages/read', (req, res) => {
  const { ids, all } = req.body || {};
  if (all) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  } else if (Array.isArray(ids) && ids.length) {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=? AND id IN (${ph})`).run(req.user.id, ...ids.map(Number));
  }
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ ok: true, data: { unread } });
});

export default r;
