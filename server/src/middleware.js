import { db, parseJSON } from './db.js';
import { verifyToken } from './util.js';

function shapeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    phone: u.phone,
    nickname: u.nickname || `用户${String(u.phone).slice(-4)}`,
    is_admin: !!u.is_admin,
    email: u.email || '',
    push_channels: parseJSON(u.push_channels, ['inapp']),
  };
}

export function authOptional(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const uid = token ? verifyToken(token) : null;
  if (uid) req.user = shapeUser(db.prepare('SELECT * FROM users WHERE id=?').get(uid));
  next();
}

export function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  next();
}

export function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!req.user.is_admin) return res.status(403).json({ ok: false, error: '需要管理员权限' });
  next();
}
