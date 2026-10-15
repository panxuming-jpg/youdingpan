/**
 * 会员中心路由：状态查询 / 订阅下单 / 订阅记录
 */
import { Router } from 'express';
import { db, getSetting, getSettingNum, isMember } from '../db.js';
import { authRequired } from '../middleware.js';
import { shapePayOrder } from '../pay.js';

const r = Router();

// 已用查看数（列表限额模式下不再按详情页计数，此处返回 0 仅为兼容旧前端）
function viewUsed(userId) {
  return 0;
}

r.get('/member/status', authRequired, (req, res) => {
  const u = db.prepare('SELECT member_expire_at FROM users WHERE id=?').get(req.user.id);
  const member = isMember(req.user.id);
  res.json({
    ok: true,
    data: {
      is_member: member,
      member_expire_at: member ? u.member_expire_at : 0,
      price: getSettingNum('member_price', 9.9),
      days: getSettingNum('member_days', 30),
      benefits: getSetting('member_benefits', ''),
      free_view_limit: getSettingNum('free_view_limit', 10),
      view_used: member ? 0 : viewUsed(req.user.id),
    },
  });
});

// 订阅记录（本人会员支付单）
r.get('/member/orders', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT * FROM pay_orders WHERE user_id=? AND scene='member' ORDER BY created_at DESC LIMIT 50`)
    .all(req.user.id);
  res.json({ ok: true, data: rows.map(shapePayOrder) });
});

export default r;
