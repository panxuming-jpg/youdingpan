import { Router } from 'express';
import { db } from '../db.js';
import { signToken, randomCode } from '../util.js';
import { authOptional, authRequired } from '../middleware.js';
import { parseJSON } from '../db.js';

const r = Router();
// 必须先解析 token 再进入 /me 路由：auth 路由挂载在 goods 之前，
// 否则 goods 内部的 authOptional 不会为 /me 运行，导致 /me 永远 401
r.use(authOptional);

function shapeUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    nickname: u.nickname || `用户${String(u.phone).slice(-4)}`,
    is_admin: !!u.is_admin,
    email: u.email || '',
    push_channels: parseJSON(u.push_channels, ['inapp']),
  };
}

r.post('/auth/send-code', (req, res) => {
  const { phone } = req.body || {};
  if (!/^1\d{10}$/.test(String(phone || ''))) {
    return res.json({ ok: false, error: '手机号格式不正确' });
  }
  const code = randomCode();
  db.prepare(`INSERT INTO verify_codes (phone, code, expire) VALUES (?,?,?)
    ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expire=excluded.expire`)
    .run(phone, code, Date.now() + 10 * 60_000);
  // 演示模式：直接返回验证码（真实环境应接入短信服务商，且不回传）
  res.json({ ok: true, data: { code } });
});

r.post('/auth/login', (req, res) => {
  const { phone, code } = req.body || {};
  if (!/^1\d{10}$/.test(String(phone || ''))) return res.json({ ok: false, error: '手机号格式不正确' });
  const rec = db.prepare('SELECT * FROM verify_codes WHERE phone=?').get(phone);
  // 演示模式：万能验证码 123456 始终可用（生产环境必须移除）
  const universal = String(code) === '123456';
  const valid = universal || (rec && rec.code === String(code) && rec.expire > Date.now());
  if (!valid) return res.json({ ok: false, error: '验证码错误或已过期' });
  db.prepare('DELETE FROM verify_codes WHERE phone=?').run(phone);

  let u = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u) {
    const ins = db.prepare('INSERT INTO users (phone, nickname, created_at) VALUES (?,?,?)').run(phone, null, Date.now());
    u = db.prepare('SELECT * FROM users WHERE id=?').get(ins.lastInsertRowid);
  }
  res.json({ ok: true, data: { token: signToken(u.id), user: shapeUser(u) } });
});

r.get('/me', authRequired, (req, res) => res.json({ ok: true, data: req.user }));

r.put('/me', authRequired, (req, res) => {
  const { nickname, email, push_channels } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (nickname !== undefined) u.nickname = String(nickname).slice(0, 20);
  if (email !== undefined) u.email = String(email).slice(0, 50);
  if (Array.isArray(push_channels)) u.push_channels = JSON.stringify(push_channels.filter(c => ['inapp', 'wechat', 'email'].includes(c)));
  db.prepare('UPDATE users SET nickname=?, email=?, push_channels=? WHERE id=?')
    .run(u.nickname, u.email, u.push_channels, u.id);
  res.json({ ok: true, data: shapeUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
});

export default r;
