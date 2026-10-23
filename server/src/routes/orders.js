/**
 * 自营订单路由（PRD FR-A5/A6/A7）：下单/托管支付/交接六步/确认收货/结算/退款
 */
import { Router } from 'express';
import { db, parseJSON, getSettingNum, fundLog, sellerCreditInfo } from '../db.js';
import { assetsZh } from '../asset_templates.js';
import { authRequired } from '../middleware.js';
import { createPayOrder } from '../pay.js';
import { notify } from '../engine/auction.js';
import { broadcast, addEvidence, advanceStep, addMessage, HANDOVER_STEPS } from '../engine/ai_service.js';
import { settleSelfOrder, refundSelfOrder } from '../engine/selftrade.js';
import { latestValuation } from '../engine/valuation.js';
import { maskAccount } from '../pay.js';

const router = Router();
const round2 = v => Math.round(v * 100) / 100;

// ---------- FR-A5 下单 ----------
router.post('/orders', authRequired, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!me.real_name || !me.id_card) return res.json({ ok: false, error: '请先完成实名认证（我的-实名认证）后再下单' });
  const { listing_id, with_compensation, with_appraisal } = req.body || {};
  const l = db.prepare("SELECT * FROM listings WHERE id=? AND status='on'").get(Number(listing_id));
  if (!l) return res.json({ ok: false, error: '商品不存在或已不可购买' });
  if (l.seller_id === me.id) return res.json({ ok: false, error: '不可购买自己上架的商品' });
  const seller = db.prepare('SELECT id_card, real_name FROM users WHERE id=?').get(l.seller_id);
  if (seller.id_card && seller.id_card === me.id_card) return res.json({ ok: false, error: '同实名主体不可自购' });
  // 同一 listing 仅允许 1 个进行中订单（下单即锁定，防多人同时购买）
  const active = db.prepare(`SELECT id FROM self_orders WHERE listing_id=? AND status IN ('pending_payment','paid','handover','await_confirm','refunding','seller_appealed')`).get(l.id);
  if (active) return res.json({ ok: false, error: '该商品正在其他交易中，暂不可购买' });
  const compFee = with_compensation && l.support_compensation ? getSettingNum('compensation_fee', 100) : 0;
  const apprFee = with_appraisal ? getSettingNum('appraisal_fee', 50) : 0;
  const total = round2(l.price + compFee + apprFee);
  const now = Date.now();
  const orderNo = `SO${now.toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  const r = db.prepare(`INSERT INTO self_orders (order_no, listing_id, buyer_id, seller_id, game_id, price, compensation_fee, appraisal_fee, total,
    status, created_at, buyer_real_name, seller_real_name) VALUES (?,?,?,?,?,?,?,?,?, 'pending_payment', ?, ?, ?)`)
    .run(orderNo, l.id, me.id, l.seller_id, l.game_id, l.price, compFee, apprFee, total, now, me.real_name, seller.real_name || '');
  const orderId = Number(r.lastInsertRowid);
  db.prepare(`UPDATE listings SET status='locked', updated_at=? WHERE id=?`).run(now, l.id);
  const pay = createPayOrder({
    userId: me.id, scene: 'self', refId: orderId,
    subject: `自营订单 ${orderNo}（${maskAccount(l.account_id)}）`, amount: total,
    timeoutMs: getSettingNum('self_pay_timeout_min', 30) * 60_000,
  });
  db.prepare('UPDATE self_orders SET pay_order_no=? WHERE id=?').run(pay.order_no, orderId);
  // 订单三方会话自创建即生成（FR-E1）
  addMessage(orderId, 'ai', `订单 ${orderNo} 已创建，请在 ${getSettingNum('self_pay_timeout_min', 30)} 分钟内完成担保支付，逾期自动取消。买家+卖家+平台客服会话已开启，支付成功后客服将拉三方服务群，全程留痕。`, { event: 'created' });
  addEvidence(orderId, 'pay', 'system', { created: true, total });
  res.json({ ok: true, data: { order_id: orderId, order_no: orderNo, total, pay_order: pay.order_no, compensation_fee: compFee, appraisal_fee: apprFee } });
});

router.get('/orders/mine', authRequired, (req, res) => {
  const role = req.query.role === 'sell' ? 'seller_id' : 'buyer_id';
  const rows = db.prepare(`SELECT o.*, l.server_name, l.account_id, g.name AS game_name FROM self_orders o
    LEFT JOIN listings l ON l.id=o.listing_id LEFT JOIN games g ON g.id=o.game_id
    WHERE o.${role}=? ORDER BY o.id DESC LIMIT 100`).all(req.user.id);
  res.json({ ok: true, data: rows.map(o => ({
    id: o.id, order_no: o.order_no, listing_id: o.listing_id, game_name: o.game_name,
    server_name: o.server_name, account_mask: maskAccount(o.account_id),
    price: o.price, compensation_fee: o.compensation_fee, appraisal_fee: o.appraisal_fee, total: o.total,
    status: o.status, handover_step: o.handover_step, created_at: o.created_at, paid_at: o.paid_at, completed_at: o.completed_at,
    valuation_snapshot: parseJSON(o.valuation_snapshot_json, null),
    refund_reason: o.refund_reason || '',
  })) });
});

// ---------- 订单详情（含协议/鉴号/会话/证据链/估值快照） ----------
router.get('/orders/:id', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ ok: false, error: '订单不存在' });
  const isParty = o.buyer_id === req.user.id || o.seller_id === req.user.id;
  if (!isParty && !req.user.is_admin) return res.status(403).json({ ok: false, error: '无权查看该订单' });
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(o.listing_id);
  const game = l ? db.prepare('SELECT name FROM games WHERE id=?').get(l.game_id) : null;
  const plan = db.prepare('SELECT * FROM compensation_plans WHERE order_id=?').get(o.id);
  const appraisals = db.prepare('SELECT * FROM appraisals WHERE order_id=? OR (listing_id=? AND order_id IS NULL AND buyer_id=?) ORDER BY id DESC')
    .all(o.id, o.listing_id, o.buyer_id)
    .map(a => ({ ...a, report: parseJSON(a.report_json, null) }));
  const messages = db.prepare('SELECT * FROM order_messages WHERE order_id=? ORDER BY created_at').all(o.id)
    .map(m => ({ ...m, meta: parseJSON(m.meta_json, null) }));
  const evidence = db.prepare('SELECT * FROM evidence_chain WHERE order_id=? ORDER BY created_at').all(o.id)
    .map(e => ({ ...e, detail: parseJSON(e.detail_json, {}) }));
  const risks = db.prepare('SELECT * FROM risk_events WHERE order_id=? ORDER BY created_at DESC').all(o.id);
  const acks = evidence.filter(e => e.type === 'ack').map(e => e.actor);
  const contract = db.prepare('SELECT * FROM e_contracts WHERE order_id=?').get(o.id);
  res.json({ ok: true, data: {
    id: o.id, order_no: o.order_no, listing_id: o.listing_id,
    listing: l ? { server_name: l.server_name, channel: l.channel, game_name: game?.name, account_mask: maskAccount(l.account_id),
      assets: parseJSON(l.assets_json, {}), assets_zh: assetsZh(parseJSON(l.assets_json, {}), game?.name || ''), images: parseJSON(l.gen_images_json, []).length ? parseJSON(l.gen_images_json, []) : parseJSON(l.raw_images_json, []),
      raw_images: parseJSON(l.raw_images_json, []), support_compensation: !!l.support_compensation, status: l.status } : null,
    buyer_id: o.buyer_id, seller_id: o.seller_id, is_buyer: o.buyer_id === req.user.id,
    price: o.price, compensation_fee: o.compensation_fee, appraisal_fee: o.appraisal_fee, total: o.total,
    status: o.status, handover_step: o.handover_step, step_hints: HANDOVER_STEPS,
    pay_order_no: o.pay_order_no || '',
    created_at: o.created_at, paid_at: o.paid_at, completed_at: o.completed_at, auto_confirm_at: o.auto_confirm_at,
    refund_reason: o.refund_reason || '',
    valuation_snapshot: parseJSON(o.valuation_snapshot_json, null),
    plan: plan ? { ...plan, terms: parseJSON(plan.terms_json, null) } : null,
    contract: contract ? { ...contract, terms: parseJSON(contract.terms_json, null) } : null,
    appraisals, messages, evidence, risks, acks,
    seller_real_name: o.seller_real_name || '',
    seller: sellerCreditInfo(o.seller_id),
  } });
});

function mustParty(req, res) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(Number(req.params.id));
  if (!o) { res.status(404).json({ ok: false, error: '订单不存在' }); return null; }
  if (o.buyer_id !== req.user.id && o.seller_id !== req.user.id && !req.user.is_admin) {
    res.status(403).json({ ok: false, error: '无权操作该订单' }); return null;
  }
  return o;
}

// ---------- 交易电子合同（买卖双方支付/签署即生效，同等法律效力） ----------
router.get('/orders/:id/contract', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  const c = db.prepare('SELECT * FROM e_contracts WHERE order_id=?').get(o.id);
  if (!c) return res.json({ ok: false, error: '电子合同将在买家完成担保支付后即时生成' });
  res.json({ ok: true, data: { ...c, terms: parseJSON(c.terms_json, null) } });
});

// 步骤 1：协议与费用确认（双方各自确认，齐备后推进）
router.post('/orders/:id/ack-step1', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.status !== 'handover' || o.handover_step !== 1) return res.json({ ok: false, error: '当前不在步骤 1' });
  const role = o.buyer_id === req.user.id ? 'buyer' : 'seller';
  addEvidence(o.id, 'ack', role, { step: 1 });
  addMessage(o.id, role, `已确认协议与费用（步骤 1）`);
  const acks = db.prepare("SELECT DISTINCT actor FROM evidence_chain WHERE order_id=? AND type='ack'").all(o.id).map(r => r.actor);
  if (acks.includes('buyer') && acks.includes('seller')) {
    const blocked = o.compensation_fee > 0 && !db.prepare(`SELECT 1 FROM compensation_plans WHERE order_id=? AND status='active'`).get(o.id);
    broadcast(o.id, 'step1_done', blocked
      ? '双方已确认费用。注意：卖家尚未签署包赔协议，签署完成前交接暂缓，已提醒卖家。'
      : '双方已完成协议与费用确认，进入步骤 2。');
    if (!blocked) advanceStep(o.id, 2);
  } else {
    broadcast(o.id, 'ack', `${role === 'buyer' ? '买家' : '卖家'}已确认协议与费用，等待另一方确认。`);
  }
  res.json({ ok: true });
});

// 步骤 2：卖家提交账号资料（字段齐备校验才推进）
router.post('/orders/:id/step2-materials', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.seller_id !== req.user.id && !req.user.is_admin) return res.json({ ok: false, error: '仅卖家可提交账号资料' });
  if (o.status !== 'handover' || o.handover_step !== 2) return res.json({ ok: false, error: '当前不在步骤 2（卖家提交资料）' });
  const { login_account, login_password, bind_phone, bind_email, note } = req.body || {};
  if (!login_account || !login_password) return res.json({ ok: false, error: '账号与密码为必填（校验字段齐备才推进）' });
  addEvidence(o.id, 'material', 'seller', { login_account, bind_phone: bind_phone || '', bind_email: bind_email || '', note: note || '' });
  addMessage(o.id, 'seller', '已提交账号登录资料与绑定信息，请买家尽快登录验号。');
  broadcast(o.id, 'step2_done', `卖家已提交账号资料（时间戳留痕）。请买家使用资料登录账号，对照商品图组核验资产（验号），并在群内回传验号截图。`);
  advanceStep(o.id, 3);
  res.json({ ok: true });
});

// 步骤 3：买家验号回传凭证 → 进入待收货确认（自动确认倒计时起算）
router.post('/orders/:id/step3-proof', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.buyer_id !== req.user.id && !req.user.is_admin) return res.json({ ok: false, error: '仅买家可回传验号凭证' });
  if (o.status !== 'handover' || o.handover_step !== 3) return res.json({ ok: false, error: '当前不在步骤 3（买家验号）' });
  const { images, note } = req.body || {};
  if (!Array.isArray(images) || !images.length) return res.json({ ok: false, error: '请上传验号截图' });
  addEvidence(o.id, 'proof', 'buyer', { images, note: note || '' });
  addMessage(o.id, 'buyer', '已完成验号，回传验号截图。');
  const autoDays = getSettingNum('self_auto_confirm_days', 7);
  db.prepare(`UPDATE self_orders SET status='await_confirm', auto_confirm_at=? WHERE id=?`).run(Date.now() + autoDays * 86_400_000, o.id);
  advanceStep(o.id, 4);
  broadcast(o.id, 'step4_hint', `换绑与二次实名完成后请点击「确认收货」；${autoDays} 天内未操作将由平台自动确认结算。`);
  res.json({ ok: true });
});

// 步骤 5：买家确认收货 → 结算
router.post('/orders/:id/confirm-receipt', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '仅买家可确认收货' });
  if (!['handover', 'await_confirm'].includes(o.status) || o.handover_step < 3) return res.json({ ok: false, error: '请先完成交接步骤' });
  if (!settleSelfOrder(o.id)) return res.json({ ok: false, error: '结算失败，订单状态已变更' });
  res.json({ ok: true });
});

// 交接失败退款申请（任一方可发起，勾选原因）
router.post('/orders/:id/refund-request', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (!['paid', 'handover', 'await_confirm'].includes(o.status)) return res.json({ ok: false, error: '当前状态不可申请退款' });
  const { reason } = req.body || {};
  if (!reason) return res.json({ ok: false, error: '请选择/填写退款原因' });
  const role = o.buyer_id === req.user.id ? 'buyer' : 'seller';
  db.prepare(`UPDATE self_orders SET status='refunding', refund_reason=?, refund_requested_at=? WHERE id=?`).run(reason, Date.now(), o.id);
  addEvidence(o.id, 'claim', role, { refund_request: reason });
  broadcast(o.id, 'refunding', `${role === 'buyer' ? '买家' : '卖家'}发起交接失败退款申请（原因：${reason}）。卖家可在 48 小时内申诉，逾期或申诉失败将全额退款。`);
  notify(o.seller_id, 'system', '订单退款申诉提醒', `订单 ${o.order_no} 被申请退款（${reason}），如无异议请在 48 小时内申诉。`);
  res.json({ ok: true });
});

// 卖家 48h 内申诉 → 转运营裁决
router.post('/orders/:id/refund-appeal', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.seller_id !== req.user.id) return res.json({ ok: false, error: '仅卖家可申诉' });
  if (o.status !== 'refunding') return res.json({ ok: false, error: '当前不在退款申诉窗口' });
  const { reason } = req.body || {};
  db.prepare(`UPDATE self_orders SET status='seller_appealed' WHERE id=?`).run(o.id);
  addEvidence(o.id, 'claim', 'seller', { refund_appeal: reason || '卖家申诉' });
  broadcast(o.id, 'appealed', `卖家已提交申诉（${reason || '未说明'}），已转运营依据证据链裁决。`);
  const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
  for (const a of admins) notify(a.id, 'system', '退款申诉待裁决', `订单 ${o.order_no} 卖家申诉，请依据证据链裁决退款/继续交接。`);
  res.json({ ok: true });
});

// 运营裁决申诉单
router.post('/admin/orders/:id/refund-decide', authRequired, (req, res, next) => {
  if (!req.user.is_admin) return res.status(403).json({ ok: false, error: '需要管理员权限' });
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(Number(req.params.id));
  if (!o || o.status !== 'seller_appealed') return res.json({ ok: false, error: '订单不在申诉待裁决状态' });
  const { action } = req.body || {};
  if (action === 'refund') {
    refundSelfOrder(o.id, `运营裁决：${req.body.reason || '申诉失败，全额退款'}`);
  } else if (action === 'continue') {
    db.prepare(`UPDATE self_orders SET status='await_confirm', refund_requested_at=NULL WHERE id=?`).run(o.id);
    broadcast(o.id, 'appeal_won', '运营裁决申诉成立，交接流程继续。如对裁决有异议可申请人工复核。');
  } else return res.json({ ok: false, error: 'action 须为 refund/continue' });
  res.json({ ok: true });
});

// 交接中加购鉴号（FR-C2 触发②）
router.post('/orders/:id/appraise', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '仅买家可加购鉴号' });
  if (!['handover', 'await_confirm'].includes(o.status)) return res.json({ ok: false, error: '仅交接中可加购鉴号' });
  const fee = getSettingNum('appraisal_fee', 50);
  const now = Date.now();
  const r = db.prepare(`INSERT INTO appraisals (listing_id, order_id, buyer_id, game_id, fee, status, created_at)
    VALUES (?,?,?,?,?, 'pending_payment', ?)`).run(o.listing_id, o.id, o.buyer_id, o.game_id, fee, now);
  const pay = createPayOrder({ userId: o.buyer_id, scene: 'appraisal', refId: Number(r.lastInsertRowid), subject: `订单 ${o.order_no} 加购鉴号服务`, amount: fee });
  broadcast(o.id, 'appraisal_pending', `买家加购鉴号服务（¥${fee.toFixed(2)}），完成支付后进入专家池（专家接单后 24h 内出具报告）。`);
  res.json({ ok: true, data: { appraisal_id: Number(r.lastInsertRowid), pay_order: pay.order_no, amount: fee } });
});

// 鉴号「不符」→ 买家一键取消订单全额退款（FR-C4）
router.post('/orders/:id/cancel-by-appraisal', authRequired, (req, res) => {
  const o = mustParty(req, res);
  if (!o) return;
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '仅买家可取消' });
  if (!['paid', 'handover', 'await_confirm'].includes(o.status)) return res.json({ ok: false, error: '当前状态不可取消' });
  const bad = db.prepare(`SELECT conclusion FROM appraisals WHERE order_id=? AND conclusion IN ('mismatch','partial')`).all(o.id);
  if (!bad.length) return res.json({ ok: false, error: '仅当鉴号结论为「不符/部分不符」时可一键取消' });
  // 不符→保持「转复核」状态；部分不符→恢复在售
  refundSelfOrder(o.id, `鉴号报告结论「${bad[0].conclusion === 'mismatch' ? '不符' : '部分不符'}」，买家取消订单全额退款（鉴号费不退）`,
    { restoreListing: bad[0].conclusion === 'mismatch' ? 'review' : 'on' });
  res.json({ ok: true });
});

// 运营：自营订单列表 + 待裁决申诉
router.get('/admin/self-orders', authRequired, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ ok: false, error: '需要管理员权限' });
  const rows = db.prepare(`SELECT o.*, l.server_name, g.name AS game_name FROM self_orders o
    LEFT JOIN listings l ON l.id=o.listing_id LEFT JOIN games g ON g.id=o.game_id
    ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ ok: true, data: rows.map(o => ({ ...o, account_mask: maskAccount(o.account_id || '') })) });
});

export default router;
