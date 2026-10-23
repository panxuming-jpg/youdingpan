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
    member_expire_at: u.member_expire_at || 0,
    is_member: (u.member_expire_at || 0) > Date.now(),
    alipay_credit_score: u.alipay_credit_score || 0,
    wechat_credit_score: u.wechat_credit_score || 0,
    credit_grade: u.credit_grade || '',
    last_active_at: u.last_active_at || 0,
  };
}

// 在线活跃心跳：请求携带 token 即视为活跃，节流 ≥60s 才写库
const lastHeartbeat = new Map();
function touchActive(uid) {
  const now = Date.now();
  const prev = lastHeartbeat.get(uid) || 0;
  if (now - prev < 60_000) return;
  lastHeartbeat.set(uid, now);
  db.prepare('UPDATE users SET last_active_at=? WHERE id=?').run(now, uid);
}

export function authOptional(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const uid = token ? verifyToken(token) : null;
  if (uid) {
    req.user = shapeUser(db.prepare('SELECT * FROM users WHERE id=?').get(uid));
    if (req.user) touchActive(uid);
  }
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
