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
import { broadcast, advanceStep, addEvidence } from './engine/ai_service.js';
import { latestValuation } from './engine/valuation.js';

const PAY_TIMEOUT_MS = 15 * 60 * 1000; // 支付单 15 分钟超时

export function genOrderNo(scene) {
  const prefix = scene === 'member' ? 'M' : scene === 'auction' ? 'A' : scene === 'self' ? 'S' : scene === 'appraisal' ? 'J' : 'P';
  return `${prefix}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createPayOrder({ userId, scene, refId = null, subject, amount, timeoutMs = PAY_TIMEOUT_MS }) {
  const orderNo = genOrderNo(scene);
  const now = Date.now();
  db.prepare(`INSERT INTO pay_orders (order_no, user_id, scene, ref_id, subject, amount, status, expire_at, created_at)
    VALUES (?,?,?,?,?,?,'pending',?,?)`)
    .run(orderNo, userId, scene, refId, subject, amount, now + timeoutMs, now);
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
  } else if (o.scene === 'self') {
    fulfillSelfOrder(o, now, channel);
  } else if (o.scene === 'appraisal') {
    fulfillAppraisalPaid(o, now);
  }
  return { ok: true, data: shapePayOrder(getPayOrder(orderNo)) };
}

// ---------- 自营订单支付履约（FR-A5/A6 + FR-D1 + FR-C2） ----------
function fulfillSelfOrder(payOrder, now, channel) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(payOrder.ref_id);
  if (!o || o.status !== 'pending_payment') return;
  db.prepare(`UPDATE self_orders SET status='handover', paid_at=?, pay_order_no=?, handover_step=1 WHERE id=?`)
    .run(now, payOrder.order_no, o.id);
  fundLog({ userId: payOrder.user_id, biz: 'self_pay', amount: payOrder.amount, direction: 'out', refNo: payOrder.order_no, channel, remark: `自营订单 ${o.order_no} 担保支付（平台托管）` });

  // 估值快照固化（FR-A7：下单时点，不可变）
  const snap = latestValuation(o.listing_id);
  if (snap) db.prepare('UPDATE self_orders SET valuation_snapshot_json=? WHERE id=?').run(JSON.stringify(snap), o.id);

  // 包赔协议：买家支付即视为买方签署；卖家 24h 内电子签，逾期引擎自动退款关闭
  if (o.compensation_fee > 0) {
    const signHours = getSettingNum('seller_sign_hours', 24);
    const terms = buildCompensationTerms(o);
    db.prepare(`INSERT INTO compensation_plans (order_id, buyer_signed_at, sign_deadline, status, terms_json, created_at)
      VALUES (?,?,?,'pending_seller',?,?)`).run(o.id, now, now + signHours * 3_600_000, JSON.stringify(terms), now);
  }
  // 随单加购鉴号 → 进入专家池待接单
  if (o.appraisal_fee > 0) {
    db.prepare(`INSERT INTO appraisals (listing_id, order_id, buyer_id, game_id, fee, status, created_at, paid_at)
      VALUES (?,?,?,?,?, 'pending_accept', ?, ?)`).run(o.listing_id, o.id, o.buyer_id, o.game_id, o.appraisal_fee, now, now);
  }
  addEvidence(o.id, 'pay', 'buyer', { order_no: o.order_no, amount: o.total, channel });
  broadcast(o.id, 'paid', `买家已完成担保支付 ¥${o.total.toFixed(2)}，货款由平台托管。${o.compensation_fee > 0 ? `找回包赔协议已生成，请卖家在 ${getSettingNum('seller_sign_hours', 24)} 小时内完成电子签署。` : ''}`);
  advanceStep(o.id, 1); // 自动开启标准交接六步
  notify(o.buyer_id, 'system', '支付成功', `自营订单 ${o.order_no} 支付成功，AI 客服已开启交接流程。`);
  notify(o.seller_id, 'system', '买家已付款', `订单 ${o.order_no} 买家已付款（平台托管）。${o.compensation_fee > 0 ? `请在 ${getSettingNum('seller_sign_hours', 24)} 小时内签署包赔协议并提交账号资料。` : '请尽快在订单会话内提交账号资料。'}`);
}

export function buildCompensationTerms(o) {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(o.listing_id);
  const b = db.prepare('SELECT real_name, id_card FROM users WHERE id=?').get(o.buyer_id);
  const s = db.prepare('SELECT real_name, id_card FROM users WHERE id=?').get(o.seller_id);
  return {
    title: '游盯盘找回包赔服务协议（平台先行赔付）',
    buyer_name: b?.real_name || '', buyer_id_mask: maskId(b?.id_card),
    seller_name: s?.real_name || '', seller_id_mask: maskId(s?.id_card),
    account_mask: l ? maskAccount(l.account_id) : '',
    game_price: o.price, compensation_fee: o.compensation_fee,
    guarantee_days: getSettingNum('compensation_days', 180),
    payout_cap: o.price,
    terms: [
      '保障对象：已完成订单的账号，被卖家或卖家关联第三方通过申诉、原始凭证、实名找回等手段夺回。',
      `保障期：确认收货起 ${getSettingNum('compensation_days', 180)} 天；赔付上限：订单商品实付价款 ¥${o.price.toFixed(2)}（不含鉴号费与包赔服务费）。`,
      '除外责任：买家主动外借/转卖/泄露凭证；站外私下交易或绕过平台改绑；买家使用外挂等违规致封号（非找回）；保障期外。认定以订单证据链为准。',
      '理赔流程：买家提交证据 → AI 收证初核 → 运营裁决（SLA 72h）→ 通过后从平台赔付资金池向买家原路赔付，同步冻结卖家钱包等额并向卖家追偿（15 日）。',
      '【找回即违约】卖家发起或协助找回已售账号即构成根本违约：平台有权冻结卖家钱包与全部在售商品、计入永久违约标记、限制提现，并支持买家与平台依法追偿；涉嫌犯罪的移送司法机关。',
    ],
    forced_notice: '本协议为平台服务承诺，非保险产品。签署人须勾选确认「找回即违约」条款并完成电子签。',
  };
}

function maskId(id) {
  if (!id || id.length < 8) return id || '';
  return id.slice(0, 4) + '**********' + id.slice(-4);
}
export function maskAccount(acc) {
  if (!acc) return '';
  if (acc.length <= 3) return acc[0] + '**';
  return acc[0] + '*'.repeat(Math.min(acc.length - 2, 6)) + acc[acc.length - 1];
}

function fulfillAppraisalPaid(payOrder, now) {
  const a = db.prepare('SELECT * FROM appraisals WHERE id=?').get(payOrder.ref_id);
  if (!a || a.status !== 'pending_payment') return;
  db.prepare(`UPDATE appraisals SET status='pending_accept', paid_at=? WHERE id=?`).run(now, a.id);
  fundLog({ userId: payOrder.user_id, biz: 'appraisal_pay', amount: payOrder.amount, direction: 'out', refNo: payOrder.order_no, remark: `鉴号服务 #${a.id} 支付` });
  if (a.order_id) broadcast(a.order_id, 'appraisal_paid', `鉴号服务已支付（¥${a.fee.toFixed(2)}），正在等待鉴号专家接单，专家接单后 24 小时内出具报告。`);
  notify(a.buyer_id, 'system', '鉴号单已受理', `鉴号单 #${a.id} 支付成功，已进入专家池等待接单。`);
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
