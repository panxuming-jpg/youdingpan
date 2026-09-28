/**
 * 统一支付服务：会员订阅 / 拍卖担保订单共用
 *
 * 当前为模拟支付通道（mock）：前端选择微信/支付宝后调用 /pay/orders/:orderNo/confirm
 * 直接按支付成功处理，完成与真实回调一致的履约逻辑（开通会员 / 订单转待发货）。
 *
 * 预留真实通道接入点：
 * - createChannelPayment()：接入微信/支付宝官方 SDK 下单，返回支付参数（二维码/跳转链接）
 * - handleChannelCallback()：接收支付平台异步回调，验签成功后同样走 markPaid()
 * 接入步骤：配置商户号/证书 → 实现上述两个函数 → 前端拿支付参数唤起收银台。
 */
import crypto from 'node:crypto';
import { db, getSettingNum, extendMembership, fundLog } from './db.js';
import { notify } from './engine/auction.js';

const PAY_TIMEOUT_MS = 15 * 60 * 1000; // 支付单 15 分钟超时

export function genOrderNo(scene) {
  const prefix = scene === 'member' ? 'M' : scene === 'auction' ? 'A' : 'P';
  return `${prefix}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createPayOrder({ userId, scene, refId = null, subject, amount }) {
  const orderNo = genOrderNo(scene);
  const now = Date.now();
  db.prepare(`INSERT INTO pay_orders (order_no, user_id, scene, ref_id, subject, amount, status, expire_at, created_at)
    VALUES (?,?,?,?,?,?,'pending',?,?)`)
    .run(orderNo, userId, scene, refId, subject, amount, now + PAY_TIMEOUT_MS, now);
  return getPayOrder(orderNo);
}

export function getPayOrder(orderNo) {
  return db.prepare('SELECT * FROM pay_orders WHERE order_no=?').get(orderNo);
}

export function shapePayOrder(o) {
  return {
    order_no: o.order_no,
    scene: o.scene,
    ref_id: o.ref_id,
    subject: o.subject,
    amount: o.amount,
    channel: o.channel,
    status: o.status,
    expire_at: o.expire_at,
    paid_at: o.paid_at,
    created_at: o.created_at,
  };
}

// 支付成功履约（幂等）：会员开通 / 拍卖订单转待发货
export function markPaid(orderNo, channel) {
  const o = getPayOrder(orderNo);
  if (!o) return { ok: false, error: '支付单不存在' };
  if (o.status === 'paid') return { ok: true, data: shapePayOrder(o) }; // 幂等：重复回调直接成功
  if (o.status !== 'pending') return { ok: false, error: '支付单已关闭' };
  const now = Date.now();
  db.prepare(`UPDATE pay_orders SET status='paid', channel=?, paid_at=? WHERE order_no=?`).run(channel, now, orderNo);

  if (o.scene === 'member') {
    const days = getSettingNum('member_days', 30);
    const expire = extendMembership(o.user_id, days);
    fundLog({ userId: o.user_id, biz: 'member_pay', amount: o.amount, direction: 'out', refNo: orderNo, channel, remark: `会员订阅 ${days} 天` });
    notify(o.user_id, 'system', '会员开通成功', `您已成功开通会员，有效期至 ${new Date(expire).toLocaleString('zh-CN')}，有效期内可无限查看全部商品详情。`);
  } else if (o.scene === 'auction') {
    const order = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(o.ref_id);
    if (order && order.status === 'pending_payment') {
      // 资金进入平台担保账户，订单转「待卖家发货」
      db.prepare(`UPDATE auction_orders SET status='pending_ship', paid_at=?, pay_order_no=? WHERE id=?`).run(now, orderNo, order.id);
      fundLog({ userId: o.user_id, biz: 'auction_pay', amount: o.amount, direction: 'out', refNo: orderNo, channel, remark: `拍卖订单 #${order.id} 担保支付` });
      const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(order.auction_id);
      notify(order.buyer_id, 'auction', '支付成功', `「${a?.title}」已支付成功，货款由平台担保，等待卖家发货。`);
      notify(order.seller_id, 'auction', '买家已付款', `「${a?.title}」买家已完成付款，请及时发货并填写物流单号。`);
    }
  }
  return { ok: true, data: shapePayOrder(getPayOrder(orderNo)) };
}

// 关闭/超时支付单（引擎扫描超时拍卖订单时同步调用）
export function closePayOrder(orderNo, status = 'timeout') {
  db.prepare(`UPDATE pay_orders SET status=? WHERE order_no=? AND status='pending'`).run(status, orderNo);
}

// 扫描并关闭超时支付单（拍卖订单的超时由拍卖引擎连带处理，这里兜底会员单）
export function sweepTimeoutPayOrders() {
  db.prepare(`UPDATE pay_orders SET status='timeout' WHERE status='pending' AND expire_at <= ?`).run(Date.now());
}

// ---------- 支付通道（当前为模拟实现，真实 SDK 在此接入） ----------

/**
 * 创建渠道支付参数。模拟通道直接返回可立即确认的信息；
 * 真实接入时按 channel 分别调微信统一下单 / 支付宝当面付，返回 qrCode/payUrl。
 */
export function createChannelPayment(order, channel) {
  if (!['wechat', 'alipay', 'mock'].includes(channel)) {
    return { ok: false, error: '不支持的支付渠道' };
  }
  // TODO(真实支付)：接入微信/支付宝官方 SDK
  // wechat: 调用统一下单 API → 返回 code_url（Native）或 prepay_id（JSAPI）
  // alipay: 调用 alipay.trade.precreate / page.pay → 返回 qr_code / 表单
  return {
    ok: true,
    data: {
      mock: true,
      channel,
      order_no: order.order_no,
      amount: order.amount,
      subject: order.subject,
    },
  };
}

/**
 * 支付平台异步回调入口（真实接入时启用）。
 * 验签通过 → markPaid(orderNo, channel)；验签失败 → 拒绝。
 */
export function handleChannelCallback(channel, _payload) {
  // TODO(真实支付)：校验渠道签名（微信 v3 签名 / 支付宝 RSA2），解析 out_trade_no
  return { ok: false, error: `渠道 ${channel} 回调未启用（当前为模拟支付环境）` };
}
