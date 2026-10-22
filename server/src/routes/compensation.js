/**
 * 找回包赔路由（PRD 模块 D）：协议签署/理赔申请/AI 初核/运营裁决/先行赔付与追偿
 * 命名规范：对外统一「找回包赔服务费 / 平台先行赔付」，不使用「保险」字样（FR-D1）。
 */
import { Router } from 'express';
import { db, parseJSON, getSettingNum, fundLog, compPoolBalance } from '../db.js';
import { authRequired, adminRequired } from '../middleware.js';
import { notify, getWallet, freeze } from '../engine/auction.js';
import { addBalance } from '../engine/auction.js';
import { broadcast, addEvidence, advanceStep } from '../engine/ai_service.js';
import { buildCompensationTerms } from '../pay.js';
import { chat, llmEnabled } from '../llm.js';

const router = Router();
const round2 = v => Math.round(v * 100) / 100;

// ---------- FR-D1 协议查看与卖家电子签 ----------
router.get('/orders/:id/plan', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(Number(req.params.id));
  if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id && !req.user.is_admin)) return res.json({ ok: false, error: '订单不存在或无权查看' });
  let plan = db.prepare('SELECT * FROM compensation_plans WHERE order_id=?').get(o.id);
  if (!plan) {
    // 未随单购买包赔时返回条款预览（不支持包赔的商品仍强制展示「找回即违约」平台规则，FR-D5）
    return res.json({ ok: true, data: { exists: false, terms_preview: buildCompensationTerms(o), forced_notice_only: true } });
  }
  res.json({ ok: true, data: {
    exists: true, id: plan.id, status: plan.status,
    buyer_signed_at: plan.buyer_signed_at, seller_signed_at: plan.seller_signed_at, sign_deadline: plan.sign_deadline,
    terms: parseJSON(plan.terms_json, null),
  } });
});

router.post('/orders/:id/plan/sign', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.seller_id !== req.user.id) return res.json({ ok: false, error: '仅卖家需电子签署（买家支付即视为签署）' });
  const plan = db.prepare("SELECT * FROM compensation_plans WHERE order_id=? AND status='pending_seller'").get(o.id);
  if (!plan) return res.json({ ok: false, error: '协议不存在或已处理' });
  const { accept_recovery_breach } = req.body || {};
  if (!accept_recovery_breach) return res.json({ ok: false, error: '须勾选确认「找回即违约」条款后再电子签（双确认）' });
  const now = Date.now();
  db.prepare(`UPDATE compensation_plans SET seller_signed_at=?, status='active' WHERE id=?`).run(now, plan.id);
  addEvidence(o.id, 'sign', 'seller', { plan_signed: true });
  broadcast(o.id, 'plan_signed', '卖家已完成包赔协议电子签署，双方签署齐备，协议生效。交接继续。');
  notify(o.buyer_id, 'system', '包赔协议生效', `订单 ${o.order_no} 卖家已签署包赔协议，平台先行赔付保障已生效。`);
  // 若此前因等待签署停留在步骤 1，双方已确认则推进
  const acks = db.prepare("SELECT DISTINCT actor FROM evidence_chain WHERE order_id=? AND type='ack'").all(o.id).map(r => r.actor);
  if (o.status === 'handover' && o.handover_step === 1 && acks.includes('buyer') && acks.includes('seller')) advanceStep(o.id, 2);
  res.json({ ok: true });
});

// ---------- FR-D3 理赔申请 + AI 收证初核 ----------
router.post('/claims', authRequired, async (req, res) => {
  const { order_id, evidence, timeline } = req.body || {};
  const o = db.prepare('SELECT * FROM self_orders WHERE id=? AND buyer_id=?').get(Number(order_id), req.user.id);
  if (!o) return res.json({ ok: false, error: '订单不存在或非本人订单' });
  if (o.status !== 'completed') return res.json({ ok: false, error: '仅已完成订单可在保障期内申请理赔' });
  const days = getSettingNum('compensation_days', 180);
  if (!o.completed_at || Date.now() - o.completed_at > days * 86_400_000) return res.json({ ok: false, error: `已过保障期（确认收货起 ${days} 天）` });
  const plan = db.prepare("SELECT id FROM compensation_plans WHERE order_id=? AND status='active'").get(o.id);
  if (!plan) return res.json({ ok: false, error: '该订单未购买/未生效找回包赔服务' });
  const existing = db.prepare('SELECT COUNT(*) AS c FROM claims WHERE order_id=? AND appeal_of IS NULL').get(o.id).c;
  if (existing >= 1) return res.json({ ok: false, error: '同一订单理赔次数限 1（驳回后可申诉一次）' });
  if (!Array.isArray(evidence) || !evidence.length || !timeline) return res.json({ ok: false, error: '请上传无法登录证据并填写时间线描述' });

  const now = Date.now();
  const r = db.prepare(`INSERT INTO claims (order_id, buyer_id, evidence_json, timeline_text, status, created_at)
    VALUES (?,?,?, ?, 'submitted', ?)`).run(o.id, o.buyer_id, JSON.stringify(evidence), String(timeline).slice(0, 2000), now);
  const claimId = Number(r.lastInsertRowid);
  addEvidence(o.id, 'claim', 'buyer', { claim_id: claimId, timeline: String(timeline).slice(0, 200) });

  // AI 收证初核：完整性校验 + 与交接证据链比对
  const handoverProof = db.prepare("SELECT COUNT(*) AS c FROM evidence_chain WHERE order_id=? AND type='proof'").get(o.id).c > 0;
  const valuationSnap = parseJSON(o.valuation_snapshot_json, null);
  const completeness = evidence.length >= 1 && timeline.length >= 20;
  let advice = `证据 ${evidence.length} 项、时间线${timeline.length >= 20 ? '完整' : '偏简略'}；交接换绑凭证${handoverProof ? '已在证据链' : '缺失'}；估值快照${valuationSnap ? '存在' : '无'}。`;
  advice += completeness && handoverProof ? '材料齐备，建议运营受理并核实登录失败与绑定变更时间线。' : '材料存在缺口，建议要求补充证据后再裁决。';
  if (llmEnabled) {
    const out = await chat([
      { role: 'system', content: '你是游戏账号交易理赔初核助手。基于给定材料输出审核建议（≤150字，中文），关注证据完整性、时间线合理性、除外责任线索（外借/转卖/站外交易/外挂封号）。不做最终裁决。' },
      { role: 'user', content: `订单：${o.order_no}，成交价 ¥${o.price}，包赔费 ¥${o.compensation_fee}，确认收货 ${new Date(o.completed_at).toLocaleDateString('zh-CN')}。买家理赔描述：${timeline}。${advice}` },
    ], { maxTokens: 300 });
    if (out) advice = out.trim().slice(0, 400);
  }
  db.prepare(`UPDATE claims SET status='reviewing', ai_advice=? WHERE id=?`).run(advice, claimId);
  broadcast(o.id, 'claim_submitted', `买家已提交找回包赔理赔申请（理赔单 #${claimId}）。AI 已完成收证初核，运营将在 72 小时内裁决。`);
  const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
  for (const a of admins) notify(a.id, 'system', '理赔待裁决', `理赔单 #${claimId}（订单 ${o.order_no}）AI 初核：${advice.slice(0, 80)}`);
  notify(o.seller_id, 'system', '理赔通知', `您的订单 ${o.order_no} 买家已发起找回理赔，平台将依据证据链审核，请配合。`);
  res.json({ ok: true, data: { id: claimId, status: 'reviewing', ai_advice: advice } });
});

// 驳回后申诉一次（复用原单）
router.post('/claims/:id/appeal', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM claims WHERE id=?').get(Number(req.params.id));
  if (!c || c.buyer_id !== req.user.id) return res.json({ ok: false, error: '理赔单不存在或无权操作' });
  if (c.status !== 'rejected') return res.json({ ok: false, error: '仅被驳回的理赔可申诉' });
  if (db.prepare('SELECT COUNT(*) AS x FROM claims WHERE appeal_of=?').get(c.id).x > 0) return res.json({ ok: false, error: '申诉机会已使用（仅可一次）' });
  const { evidence, timeline } = req.body || {};
  const now = Date.now();
  const r = db.prepare(`INSERT INTO claims (order_id, buyer_id, evidence_json, timeline_text, status, appeal_of, created_at)
    VALUES (?,?,?,?, 'reviewing', ?, ?)`)
    .run(c.order_id, c.buyer_id, JSON.stringify(evidence || []), String(timeline || c.timeline_text).slice(0, 2000), c.id, now);
  const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
  for (const a of admins) notify(a.id, 'system', '理赔申诉', `理赔单 #${c.id} 买家申诉（新单 #${r.lastInsertRowid}），请复核。`);
  res.json({ ok: true, data: { id: Number(r.lastInsertRowid) } });
});

// ---------- FR-D4 运营裁决 + 先行赔付 + 追偿 ----------
router.get('/admin/claims', authRequired, adminRequired, (_req, res) => {
  const rows = db.prepare(`SELECT c.*, o.order_no, o.price, o.seller_id, o.buyer_id FROM claims c
    LEFT JOIN self_orders o ON o.id=c.order_id WHERE c.appeal_of IS NULL ORDER BY c.id DESC LIMIT 200`).all();
  res.json({ ok: true, data: rows.map(c => ({ ...c, evidence: parseJSON(c.evidence_json, []) })) });
});

router.post('/admin/claims/:id/decide', authRequired, adminRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM claims WHERE id=?').get(Number(req.params.id));
  if (!c) return res.json({ ok: false, error: '理赔单不存在' });
  if (!['submitted', 'reviewing'].includes(c.status)) return res.json({ ok: false, error: '该理赔单已裁决' });
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(c.order_id);
  const { action, reason } = req.body || {};
  const now = Date.now();
  if (action === 'approve') {
    const payout = round2(Math.min(o.price, c.payout_amount || o.price)); // 赔付上限=商品实付价款
    const pool = compPoolBalance();
    if (pool < payout) {
      // 池余额不足仍先行赔付（演示），记录缺口
      console.warn(`[comp] 赔付资金池余额 ¥${pool} 不足支付 ¥${payout}，先行垫付`);
    }
    db.prepare(`UPDATE claims SET status='approved', decision=?, payout_amount=?, decided_at=? WHERE id=?`)
      .run(reason || '审核通过', payout, now, c.id);
    fundLog({ userId: null, biz: 'comp_payout', amount: payout, direction: 'out', refNo: o.order_no, remark: `理赔单 #${c.id} 先行赔付买家` });
    addBalance(o.buyer_id, payout);
    fundLog({ userId: o.buyer_id, biz: 'comp_payout', amount: payout, direction: 'in', refNo: o.order_no, remark: `订单 ${o.order_no} 找回包赔先行赔付到账` });
    // 冻结卖家钱包等额
    const w = getWallet(o.seller_id);
    const fr = Math.min(w.balance, payout);
    if (fr > 0) freeze(o.seller_id, fr);
    db.prepare(`UPDATE self_orders SET status='compensated_closed' WHERE id=?`).run(o.id);
    addEvidence(o.id, 'claim', 'admin', { claim_id: c.id, approved: true, payout });
    broadcast(o.id, 'claim_approved', `理赔审核通过：平台已从赔付资金池向买家先行赔付 ¥${payout.toFixed(2)}，同步冻结卖家钱包等额资金，并向卖家发出追偿通知（15 日）。`);
    notify(o.buyer_id, 'system', '理赔通过', `订单 ${o.order_no} 理赔成立，¥${payout.toFixed(2)} 已赔付到您的钱包。`);
    notify(o.seller_id, 'system', '追偿通知', `订单 ${o.order_no} 理赔成立，平台已赔付买家 ¥${payout.toFixed(2)} 并冻结您钱包等额资金。请于 15 日内处理异议，逾期将划扣并标记永久违约。`);
  } else if (action === 'reject') {
    if (!reason) return res.json({ ok: false, error: '驳回必须附理由' });
    db.prepare(`UPDATE claims SET status='rejected', decision=?, decided_at=? WHERE id=?`).run(reason, now, c.id);
    addEvidence(o.id, 'claim', 'admin', { claim_id: c.id, rejected: true, reason });
    broadcast(o.id, 'claim_rejected', `理赔审核未通过：${reason}。买家可申诉一次。`);
    notify(o.buyer_id, 'system', '理赔驳回', `订单 ${o.order_no} 理赔被驳回：${reason}。如有补充证据可申诉一次。`);
  } else {
    return res.json({ ok: false, error: 'action 须为 approve/reject' });
  }
  res.json({ ok: true });
});

// 赔付资金池余额 + 理赔统计（运营可见）
router.get('/admin/comp-pool', authRequired, adminRequired, (_req, res) => {
  const accrual = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fund_logs WHERE biz='comp_accrual'").get().s;
  const payout = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fund_logs WHERE biz='comp_payout' AND direction='out'").get().s;
  res.json({ ok: true, data: {
    balance: compPoolBalance(),
    total_accrual: round2(accrual),
    total_payout: round2(payout),
    accrual_rate: getSettingNum('comp_pool_accrual', 0.3),
    compensation_fee: getSettingNum('compensation_fee', 100),
  } });
});

export default router;
