/**
 * 自营交易引擎（PRD v2.0）：超时扫描 + 结算/退款共享函数
 * 扫描项：待支付超时取消 / 卖家逾期未签包赔协议 / 交接自动确认收货 /
 *         卖家24h无响应提醒 / 鉴号2h无人接单提醒 / 退款申诉窗口 / 追偿划扣 / 保障期到期
 */
import { db, getSettingNum, fundLog } from '../db.js';
import { notify, getWallet, addBalance, deductFrozen } from './auction.js';
import { closePayOrder } from '../pay.js';
import { broadcast, addEvidence, advanceStep } from './ai_service.js';
import { revalueGame } from './valuation.js';

const SCAN_INTERVAL = 5000;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const reminded = new Set(); // 进程内去重：卖家失联/鉴号超时提醒只发一次

const round2 = v => Math.round(v * 100) / 100;

/** 确认收货结算（手动/自动共用）：扣佣金→入卖家钱包；Listing=已售出；包赔保障期起算 */
export function settleSelfOrder(orderId) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(orderId);
  if (!o || !['paid', 'handover', 'await_confirm'].includes(o.status)) return false;
  const now = Date.now();
  const rate = getSettingNum('self_commission_rate', 0.06);
  const fee = round2(o.price * rate);
  const net = round2(o.price - fee);
  addBalance(o.seller_id, net);
  const refNo = o.pay_order_no || o.order_no;
  fundLog({ userId: o.seller_id, biz: 'escrow_settle', amount: net, direction: 'in', refNo, remark: `自营订单 ${o.order_no} 确认收货结算（佣金 ¥${fee}）` });
  fundLog({ userId: null, biz: 'self_fee', amount: fee, direction: 'in', refNo, remark: `自营订单 ${o.order_no} 平台佣金` });
  if (o.compensation_fee > 0) {
    fundLog({ userId: null, biz: 'comp_fee_income', amount: o.compensation_fee, direction: 'in', refNo, remark: `订单 ${o.order_no} 找回包赔服务费` });
    const accrual = round2(o.compensation_fee * getSettingNum('comp_pool_accrual', 0.3));
    fundLog({ userId: null, biz: 'comp_accrual', amount: accrual, direction: 'in', refNo, remark: `订单 ${o.order_no} 赔付资金池计提` });
    db.prepare(`UPDATE compensation_plans SET status='active' WHERE order_id=? AND status IN ('pending_seller','active')`).run(orderId);
  }
  db.prepare(`UPDATE self_orders SET status='completed', completed_at=?, auto_confirm_at=NULL, handover_step=6 WHERE id=?`).run(now, orderId);
  db.prepare(`UPDATE listings SET status='sold' WHERE id=? AND status IN ('locked','on')`).run(o.listing_id);
  addEvidence(orderId, 'settle', 'system', { price: o.price, commission: fee, net });
  advanceStep(orderId, 6);
  broadcast(orderId, 'completed', `交易完成：货款 ¥${net.toFixed(2)}（已扣佣金 ¥${fee.toFixed(2)}）划入卖家钱包。${o.compensation_fee > 0 ? `找回包赔保障期 ${getSettingNum('compensation_days', 180)} 天已起算，期内账号被找回可申请理赔。` : ''}`);
  notify(o.seller_id, 'system', '自营订单结算到账', `订单 ${o.order_no} 已完成，货款 ¥${net.toFixed(2)} 已入钱包。`);
  notify(o.buyer_id, 'system', '交易完成', `订单 ${o.order_no} 已确认收货，交易完成。感谢使用游盯盘担保流程。`);
  revalueGame(o.game_id).catch(() => {}); // 新成交样本 → 同游戏在售商品重估
  return true;
}

/** 全额退款关闭（超时未签/鉴定不符取消/交接失败退款） */
export function refundSelfOrder(orderId, reason, { restoreListing = 'on' } = {}) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(orderId);
  if (!o || ['refunded', 'completed', 'cancelled', 'compensated_closed'].includes(o.status)) return false;
  addBalance(o.buyer_id, o.total);
  fundLog({ userId: o.buyer_id, biz: 'refund', amount: o.total, direction: 'in', refNo: o.order_no, remark: `订单 ${o.order_no} 全额退款：${reason}` });
  db.prepare(`UPDATE self_orders SET status='refunded', refund_reason=?, completed_at=NULL WHERE id=?`).run(reason, orderId);
  if (restoreListing) db.prepare(`UPDATE listings SET status=? WHERE id=? AND status IN ('locked','on','review')`).run(restoreListing, o.listing_id);
  db.prepare(`UPDATE compensation_plans SET status='void' WHERE order_id=? AND status!='active'`).run(orderId);
  if (o.pay_order_no) closePayOrder(o.pay_order_no, 'closed');
  addEvidence(orderId, 'settle', 'system', { refund: o.total, reason });
  broadcast(orderId, 'refunded', `订单已退款关闭：${reason}。¥${o.total.toFixed(2)} 已原路退回买家账户。`);
  notify(o.buyer_id, 'system', '订单退款完成', `订单 ${o.order_no} 已退款 ¥${o.total.toFixed(2)}。`);
  notify(o.seller_id, 'system', '订单退款关闭', `订单 ${o.order_no} 已退款关闭：${reason}`);
  return true;
}

function scan() {
  const now = Date.now();
  try {
    // 1. 待支付超时 → 取消并释放 Listing 锁定
    const payTimeout = getSettingNum('self_pay_timeout_min', 30) * MIN;
    const stale = db.prepare(`SELECT * FROM self_orders WHERE status='pending_payment' AND created_at <= ?`).all(now - payTimeout);
    for (const o of stale) {
      db.prepare(`UPDATE self_orders SET status='cancelled', refund_reason='超时未支付自动取消' WHERE id=?`).run(o.id);
      db.prepare(`UPDATE listings SET status='on' WHERE id=? AND status='locked'`).run(o.listing_id);
      if (o.pay_order_no) closePayOrder(o.pay_order_no, 'timeout');
      broadcast(o.id, 'cancelled', '订单超过 30 分钟未支付，已自动取消并释放商品锁定。');
      notify(o.buyer_id, 'system', '订单已取消', `订单 ${o.order_no} 超时未支付已取消。`);
    }

    // 2. 已支付但卖家超 24h 未签包赔协议 → 退款关闭 + 违约记录
    const signHours = getSettingNum('seller_sign_hours', 24) * HOUR;
    const overduePlans = db.prepare(`
      SELECT p.*, o.order_no FROM compensation_plans p JOIN self_orders o ON o.id=p.order_id
      WHERE p.status='pending_seller' AND p.sign_deadline <= ? AND o.status IN ('paid','handover','await_confirm')
    `).all(now);
    for (const p of overduePlans) {
      db.prepare(`UPDATE compensation_plans SET status='expired' WHERE id=?`).run(p.id);
      refundSelfOrder(p.order_id, '卖家逾期未签署找回包赔协议，订单自动退款关闭');
      db.prepare('INSERT INTO violations (user_id, order_id, type, detail, created_at) VALUES (?,?,?,?,?)')
        .run(p.seller_id, p.order_id, 'sign_overdue', `订单 ${p.order_no} 卖家超 ${getSettingNum('seller_sign_hours', 24)}h 未签署包赔协议`, now);
      notify(p.seller_id, 'system', '违约记录', `您未在时限内签署订单 ${p.order_no} 包赔协议，订单已退款关闭，已计入违约记录。`);
    }

    // 3. 交接中/待确认超过自动确认天数 → 自动确认收货结算
    const autoOrders = db.prepare(`SELECT id FROM self_orders WHERE status IN ('handover','await_confirm') AND auto_confirm_at IS NOT NULL AND auto_confirm_at <= ?`).all(now);
    for (const o of autoOrders) settleSelfOrder(o.id);

    // 4. 交接中卖家 24h 无响应 → AI 提醒 + 通知运营（进程内去重）
    const silenceMs = 24 * HOUR;
    const activeOrders = db.prepare(`SELECT * FROM self_orders WHERE status IN ('paid','handover') AND handover_step BETWEEN 1 AND 2 AND paid_at <= ?`).all(now - silenceMs);
    for (const o of activeOrders) {
      if (reminded.has('sil' + o.id)) continue;
      const lastSeller = db.prepare(`SELECT created_at FROM order_messages WHERE order_id=? AND sender='seller' ORDER BY id DESC LIMIT 1`).get(o.id);
      if (lastSeller && lastSeller.created_at > now - silenceMs) continue;
      reminded.add('sil' + o.id);
      broadcast(o.id, 'seller_silent', '卖家已超过 24 小时未响应交接流程，平台客服已提醒并通知运营跟进。如长时间无进展可申请「交接失败退款」。');
      notify(o.seller_id, 'system', '交接超时提醒', `订单 ${o.order_no} 请尽快在订单会话内提交账号资料，超时将由平台介入。`);
      const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
      for (const a of admins) notify(a.id, 'system', '卖家交接失联预警', `订单 ${o.order_no}（#${o.id}）卖家 24h 无响应，请关注。`);
    }

    // 5. 鉴号单 2h 无人接单 → 提醒运营（去重）
    const poolStale = db.prepare(`SELECT * FROM appraisals WHERE status='pending_accept' AND paid_at <= ?`).all(now - 2 * HOUR);
    for (const a of poolStale) {
      if (reminded.has('apr' + a.id)) continue;
      reminded.add('apr' + a.id);
      const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
      for (const ad of admins) notify(ad.id, 'system', '鉴号单超时无人接单', `鉴号单 #${a.id}（商品 #${a.listing_id}）超 2 小时无专家接单，请协调专家池。`);
    }

    // 6. 退款申诉窗口：refunding 超 48h 卖家未申诉 → 全额退款
    const refundStale = db.prepare(`SELECT * FROM self_orders WHERE status='refunding' AND refund_requested_at <= ?`).all(now - 48 * HOUR);
    for (const o of refundStale) refundSelfOrder(o.id, `交接失败退款（买家原因：${o.refund_reason || '未说明'}），卖家 48h 内未申诉`);

    // 7. 理赔追偿：赔付成立 15 日后卖家未异议 → 划扣冻结金 + 永久违约
    const recoveryDays = 15 * DAY;
    const claims = db.prepare(`SELECT c.*, o.seller_id, o.order_no FROM claims c JOIN self_orders o ON o.id=c.order_id
      WHERE c.status='approved' AND c.recovered_at IS NULL AND c.decided_at <= ?`).all(now - recoveryDays);
    for (const c of claims) {
      const w = getWallet(c.seller_id);
      const deduct = Math.min(w.frozen, c.payout_amount);
      if (deduct > 0) deductFrozen(c.seller_id, deduct);
      db.prepare('UPDATE claims SET recovered_at=? WHERE id=?').run(now, c.id);
      fundLog({ userId: c.seller_id, biz: 'claim_recovery', amount: deduct, direction: 'out', refNo: c.order_no, remark: `理赔单 #${c.id} 追偿划扣（赔付买家后 15 日无异议）` });
      db.prepare('INSERT INTO violations (user_id, order_id, type, detail, created_at) VALUES (?,?,?,?,?)')
        .run(c.seller_id, c.order_id, 'claim_recovery', `理赔单 #${c.id} 追偿划扣 ¥${deduct.toFixed(2)}`, now);
      notify(c.seller_id, 'system', '追偿划扣完成', `订单 ${c.order_no} 理赔追偿已从您的钱包冻结款划扣 ¥${deduct.toFixed(2)}，账号标记永久违约。`);
    }

    // 8. 保障期到期 → 协议期满终止
    const expPlans = db.prepare(`
      SELECT p.id FROM compensation_plans p JOIN self_orders o ON o.id=p.order_id
      WHERE p.status='active' AND o.completed_at IS NOT NULL AND o.completed_at <= ?
    `).all(now - getSettingNum('compensation_days', 180) * DAY);
    for (const p of expPlans) db.prepare(`UPDATE compensation_plans SET status='expired' WHERE id=? AND status='active'`).run(p.id);
  } catch (e) {
    console.error('[selftrade] 扫描异常:', e);
  }
}

export function startSelfTradeEngine() {
  setInterval(scan, SCAN_INTERVAL);
  console.log('[selftrade] 自营交易引擎已启动（5s 扫描间隔）');
}
