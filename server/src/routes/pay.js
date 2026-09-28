/**
 * 统一支付路由：会员订阅 / 拍卖担保订单共用支付单
 * 当前为模拟支付通道（选择渠道后 confirm 即支付成功），真实 SDK 接入点见 pay.js
 */
import { Router } from 'express';
import { db, getSettingNum } from '../db.js';
import { authRequired } from '../middleware.js';
import {
  createPayOrder, getPayOrder, shapePayOrder, markPaid,
  createChannelPayment, handleChannelCallback,
} from '../pay.js';

const r = Router();

// 创建会员支付单（scene=member；拍卖支付单由 auctions.js 内部创建）
r.post('/pay/orders', authRequired, (req, res) => {
  const { scene } = req.body || {};
  if (scene !== 'member') return res.json({ ok: false, error: '不支持的支付场景' });

  // 复用未过期的待支付会员单，避免重复下单
  const exist = db.prepare(`SELECT * FROM pay_orders WHERE user_id=? AND scene='member' AND status='pending' AND expire_at>? ORDER BY created_at DESC LIMIT 1`)
    .get(req.user.id, Date.now());
  if (exist) return res.json({ ok: true, data: shapePayOrder(exist) });

  const price = getSettingNum('member_price', 9.9);
  const days = getSettingNum('member_days', 30);
  const order = createPayOrder({
    userId: req.user.id,
    scene: 'member',
    subject: `游盯盘会员月卡（${days}天）`,
    amount: price,
  });
  res.json({ ok: true, data: shapePayOrder(order) });
});

// 获取支付单状态（前端轮询；仅本人或管理员）
r.get('/pay/orders/:orderNo', authRequired, (req, res) => {
  const o = getPayOrder(req.params.orderNo);
  if (!o) return res.json({ ok: false, error: '支付单不存在' });
  if (o.user_id !== req.user.id && !req.user.is_admin) return res.json({ ok: false, error: '无权查看此支付单' });
  res.json({ ok: true, data: shapePayOrder(o) });
});

// 选择渠道并获取支付参数（模拟通道直接返回可确认信息）
r.post('/pay/orders/:orderNo/channel', authRequired, (req, res) => {
  const o = getPayOrder(req.params.orderNo);
  if (!o) return res.json({ ok: false, error: '支付单不存在' });
  if (o.user_id !== req.user.id) return res.json({ ok: false, error: '无权操作此支付单' });
  if (o.status !== 'pending') return res.json({ ok: false, error: '支付单已关闭或已支付' });
  if (o.expire_at <= Date.now()) return res.json({ ok: false, error: '支付单已超时，请重新下单' });
  const { channel } = req.body || {};
  const result = createChannelPayment(o, channel);
  if (!result.ok) return res.json({ ok: false, error: result.error });
  res.json({ ok: true, data: result.data });
});

// 模拟支付成功确认（真实环境下由支付平台异步回调触发 markPaid）
r.post('/pay/orders/:orderNo/confirm', authRequired, (req, res) => {
  const o = getPayOrder(req.params.orderNo);
  if (!o) return res.json({ ok: false, error: '支付单不存在' });
  if (o.user_id !== req.user.id) return res.json({ ok: false, error: '无权操作此支付单' });
  if (o.status === 'pending' && o.expire_at <= Date.now()) {
    return res.json({ ok: false, error: '支付单已超时，请重新下单' });
  }
  const channel = ['wechat', 'alipay'].includes(req.body?.channel) ? req.body.channel : 'mock';
  const result = markPaid(o.order_no, channel);
  if (!result.ok) return res.json({ ok: false, error: result.error });
  res.json({ ok: true, data: result.data });
});

// 支付平台异步回调入口（真实接入时启用，当前 stub）
r.post('/pay/callback/:channel', (req, res) => {
  const result = handleChannelCallback(req.params.channel, req.body);
  res.status(result.ok ? 200 : 400).json(result);
});

export default r;
