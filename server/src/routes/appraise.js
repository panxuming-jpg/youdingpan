/**
 * 鉴号专家路由（PRD 模块 C）：入驻/接单池/报告/交易联动/分成结算
 */
import { Router } from 'express';
import { db, parseJSON, getSettingNum, fundLog } from '../db.js';
import { assetsZh } from '../asset_templates.js';
import { authRequired, adminRequired } from '../middleware.js';
import { notify } from '../engine/auction.js';
import { getWallet, addBalance, freeze } from '../engine/auction.js';
import { broadcast, addEvidence } from '../engine/ai_service.js';

const router = Router();
const round2 = v => Math.round(v * 100) / 100;
const CONCLUSION_LABEL = { match: '相符', partial: '部分不符', mismatch: '不符', incapable: '无法鉴定' };

// ---------- FR-C1 专家入驻 ----------
router.post('/expert/apply', authRequired, (req, res) => {
  const { game_id, qual_images } = req.body || {};
  const me = db.prepare('SELECT real_name, face_verified FROM users WHERE id=?').get(req.user.id);
  if (!me.real_name || !me.face_verified) return res.json({ ok: false, error: '请先完成实名认证' });
  if (!game_id || !Array.isArray(qual_images) || !qual_images.length) return res.json({ ok: false, error: '请选择游戏并上传资历证明（段位/资产/交易履历截图）' });
  db.prepare(`INSERT INTO experts (user_id, game_id, qual_images, status, created_at) VALUES (?,?,?, 'applying', ?)
    ON CONFLICT(user_id, game_id) DO UPDATE SET qual_images=excluded.qual_images, status='applying', created_at=excluded.created_at`)
    .run(req.user.id, game_id, JSON.stringify(qual_images), Date.now());
  res.json({ ok: true, data: { status: 'applying' } });
});

router.get('/expert/me', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT e.*, g.name AS game_name FROM experts e LEFT JOIN games g ON g.id=e.game_id WHERE e.user_id=?`).all(req.user.id)
    .map(e => ({ ...e, qual_images: parseJSON(e.qual_images, []) }));
  res.json({ ok: true, data: rows });
});

// 接单池：待接单 + 游戏授权匹配 + 排除自己名下商品
router.get('/expert/pool', authRequired, (req, res) => {
  const mine = db.prepare("SELECT game_id FROM experts WHERE user_id=? AND status IN ('trial','approved')").all(req.user.id).map(r => r.game_id);
  if (!mine.length) return res.json({ ok: true, data: [] });
  const rows = db.prepare(`SELECT a.*, l.server_name, l.account_id, l.price, g.name AS game_name,
      (SELECT COUNT(*) FROM order_messages WHERE order_id=a.order_id) AS msg_count
    FROM appraisals a LEFT JOIN listings l ON l.id=a.listing_id LEFT JOIN games g ON g.id=a.game_id
    WHERE a.status='pending_accept' AND a.game_id IN (${mine.map(() => '?').join(',')}) AND l.seller_id != ?
    ORDER BY a.paid_at`).all(...mine, req.user.id);
  res.json({ ok: true, data: rows.map(a => ({
    id: a.id, listing_id: a.listing_id, order_id: a.order_id, game_name: a.game_name,
    server_name: a.server_name, price: a.price, fee: a.fee, paid_at: a.paid_at,
    assets: a.listing_id ? assetsZh(parseJSON(db.prepare('SELECT assets_json FROM listings WHERE id=?').get(a.listing_id)?.assets_json, {}), a.game_name || '') : {},
  })) });
});

router.post('/appraisals/:id/accept', authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM appraisals WHERE id=?').get(Number(req.params.id));
  if (!a) return res.json({ ok: false, error: '鉴号单不存在' });
  if (a.status !== 'pending_accept') return res.json({ ok: false, error: '已被接单或状态不可接' });
  const exp = db.prepare("SELECT * FROM experts WHERE user_id=? AND game_id=? AND status IN ('trial','approved')").get(req.user.id, a.game_id);
  if (!exp) return res.json({ ok: false, error: '您未获得该游戏的鉴号授权' });
  const l = db.prepare('SELECT seller_id FROM listings WHERE id=?').get(a.listing_id);
  if (l && l.seller_id === req.user.id) return res.json({ ok: false, error: '不可鉴定自己名下商品' });
  db.prepare(`UPDATE appraisals SET status='in_progress', expert_id=?, accepted_at=? WHERE id=?`).run(req.user.id, Date.now(), a.id);
  if (a.order_id) broadcast(a.order_id, 'appraisal_accepted', `鉴号专家已接单（#${a.id}），将在 24 小时内出具鉴定报告。`);
  res.json({ ok: true });
});

// ---------- FR-C3 报告 + FR-C4 交易联动 ----------
router.post('/appraisals/:id/report', authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM appraisals WHERE id=?').get(Number(req.params.id));
  if (!a) return res.json({ ok: false, error: '鉴号单不存在' });
  if (a.status !== 'in_progress' || a.expert_id !== req.user.id) return res.json({ ok: false, error: '仅接单专家可提交报告' });
  const { conclusion, items, risk_level, advice, incapable_reason } = req.body || {};
  if (!['match', 'partial', 'mismatch', 'incapable'].includes(conclusion)) return res.json({ ok: false, error: '结论须为 相符/部分不符/不符/无法鉴定' });
  const now = Date.now();
  const report = { conclusion, conclusion_label: CONCLUSION_LABEL[conclusion], items: items || [], risk_level: risk_level || 'low', advice: advice || '', incapable_reason: incapable_reason || '' };
  db.prepare(`UPDATE appraisals SET status='reported', conclusion=?, report_json=?, reported_at=? WHERE id=?`)
    .run(conclusion, JSON.stringify(report), now, a.id);

  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(a.listing_id);
  const label = CONCLUSION_LABEL[conclusion];
  const order = a.order_id ? db.prepare('SELECT * FROM self_orders WHERE id=?').get(a.order_id) : null;

  // 联动（FR-C4）
  if (conclusion === 'match') {
    db.prepare('UPDATE listings SET verified_until=? WHERE id=?').run(now + 30 * 86_400_000, a.listing_id); // 「已鉴·相符」30 天
    if (order) broadcast(order.id, 'appraisal_report', `鉴号报告已出具：结论「相符」，找回风险等级 ${report.risk_level === 'low' ? '低' : report.risk_level === 'mid' ? '中' : '高'}。商品已挂「已鉴·相符」标识（30 天）。交接可继续。`);
  } else if (conclusion === 'partial') {
    const diff = (items || []).filter(i => !i.match).map(i => `${i.name}：填报 ${i.claimed} / 实际 ${i.actual}`).join('；') || '详见报告核对表';
    if (order) broadcast(order.id, 'appraisal_report', `鉴号报告结论「部分不符」。差异清单：${diff}。买家可选择：按卖家确认修正后继续交接，或一键取消订单全额退款（鉴号费不退）。`);
  } else if (conclusion === 'mismatch') {
    db.prepare(`UPDATE listings SET status='review' WHERE id=? AND status IN ('on','locked')`).run(a.listing_id); // 强制转复核
    const mismatchCount = db.prepare(`SELECT COUNT(*) AS c FROM appraisals WHERE listing_id=? AND conclusion='mismatch'`).get(a.listing_id).c;
    if (mismatchCount >= 2 && l) { // 两次不符 → 下架并冻结卖家钱包
      db.prepare(`UPDATE listings SET status='offline' WHERE id=?`).run(a.listing_id);
      const w = getWallet(l.seller_id);
      const freezeAmt = Math.min(w.balance, l.price);
      if (freezeAmt > 0) freeze(l.seller_id, freezeAmt);
      db.prepare('INSERT INTO violations (user_id, order_id, type, detail, created_at) VALUES (?,?,?,?,?)')
        .run(l.seller_id, a.order_id, 'appraisal_mismatch', `商品 #${a.listing_id} 两次鉴号「不符」，下架并冻结钱包 ¥${freezeAmt.toFixed(2)}`, now);
      notify(l.seller_id, 'system', '商品冻结处理', `您的商品 #${a.listing_id} 累计两次鉴号结论「不符」，已下架并冻结钱包等额资金，请配合运营处理。`);
    }
    if (order) broadcast(order.id, 'appraisal_report', `鉴号报告结论「不符」！买家可一键取消订单全额退款；商品已转运营复核。`);
    notifyBuyerAndSeller(order, a, label);
  } else if (conclusion === 'incapable') {
    if (incapable_reason === 'seller_uncooperative') {
      // 卖家超时不配合 → 视为「不符」处理
      db.prepare(`UPDATE listings SET status='review' WHERE id=? AND status IN ('on','locked')`).run(a.listing_id);
      if (order) broadcast(order.id, 'appraisal_report', `专家因「卖家不配合」无法鉴定，按「不符」规则处理：买家可申请取消订单，商品转运营复核。`);
    } else {
      // 专家能力不足 → 转单重鉴，原鉴号费退买家
      db.prepare(`UPDATE appraisals SET status='reassigned', expert_id=NULL WHERE id=?`).run(a.id);
      addBalance(a.buyer_id, a.fee);
      fundLog({ userId: a.buyer_id, biz: 'refund', amount: a.fee, direction: 'in', refNo: `APPR${a.id}`, remark: `鉴号单 #${a.id} 转单重鉴，鉴号费退回` });
      const r2 = db.prepare(`INSERT INTO appraisals (listing_id, order_id, buyer_id, game_id, fee, status, created_at, paid_at)
        VALUES (?,?,?,?,?, 'pending_accept', ?, ?)`).run(a.listing_id, a.order_id, a.buyer_id, a.game_id, a.fee, now, now);
      if (order) broadcast(order.id, 'appraisal_report', `原专家无法完成鉴定，鉴号费 ¥${a.fee.toFixed(2)} 已退回并转单重鉴（新单 #${r2.lastInsertRowid}）。`);
    }
  }

  // 报告永久挂订单证据链；鉴定完成即结算专家分成（「不符」仍计费）
  if (order) addEvidence(order.id, 'report', 'expert', { appraisal_id: a.id, conclusion, items: report.items, risk_level: report.risk_level });
  const share = round2(a.fee * getSettingNum('expert_share', 0.7));
  if (conclusion !== 'incapable' || incapable_reason === 'seller_uncooperative') {
    addBalance(req.user.id, share);
    fundLog({ userId: req.user.id, biz: 'expert_share', amount: share, direction: 'in', refNo: `APPR${a.id}`, remark: `鉴号单 #${a.id} 专家分成（${Math.round(getSettingNum('expert_share', 0.7) * 100)}%）` });
    notify(req.user.id, 'system', '鉴号分成到账', `鉴号单 #${a.id} 已完成，分成 ¥${share.toFixed(2)} 已入钱包。`);
    const exp = db.prepare('SELECT * FROM experts WHERE user_id=? AND game_id=?').get(req.user.id, a.game_id);
    if (exp && exp.status === 'trial') {
      const done = (exp.trial_done || 0) + 1;
      const ns = done >= getSettingNum('trial_appraise_count', 2) ? 'approved' : 'trial';
      db.prepare('UPDATE experts SET trial_done=?, status=? WHERE id=?').run(done, ns, exp.id);
      if (ns === 'approved') notify(req.user.id, 'system', '专家转正', '您已完成试鉴定考核，正式签约入驻为鉴号专家。');
    }
  }
  if (['mismatch', 'partial'].includes(conclusion)) {
    const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
    for (const ad of admins) notify(ad.id, 'system', '鉴号异常结论', `鉴号单 #${a.id}（商品 #${a.listing_id}）结论「${label}」，请复核。`);
  }
  res.json({ ok: true });
});

function notifyBuyerAndSeller(order, a, label) {
  if (!order) return;
  notify(order.buyer_id, 'system', '鉴号报告出具', `订单 ${order.order_no} 鉴号结论「${label}」，请查看报告并选择后续操作。`);
  notify(order.seller_id, 'system', '鉴号报告出具', `订单 ${order.order_no} 鉴号结论「${label}」。`);
}

// 买家查看某商品的鉴号报告（详情页）
router.get('/appraisals/:id', authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM appraisals WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ ok: false, error: '不存在' });
  const l = db.prepare('SELECT seller_id FROM listings WHERE id=?').get(a.listing_id);
  const isParty = a.buyer_id === req.user.id || a.expert_id === req.user.id || (l && l.seller_id === req.user.id) || req.user.is_admin;
  if (!isParty) return res.status(403).json({ ok: false, error: '无权查看' });
  res.json({ ok: true, data: { ...a, report: parseJSON(a.report_json, null) } });
});

// ---------- 运营：专家入驻审核 ----------
router.get('/admin/experts', authRequired, adminRequired, (_req, res) => {
  const rows = db.prepare(`SELECT e.*, u.nickname, u.phone, g.name AS game_name FROM experts e
    LEFT JOIN users u ON u.id=e.user_id LEFT JOIN games g ON g.id=e.game_id ORDER BY e.id DESC LIMIT 200`).all();
  res.json({ ok: true, data: rows.map(e => ({ ...e, qual_images: parseJSON(e.qual_images, []) })) });
});

router.post('/admin/experts/:id/review', authRequired, adminRequired, (req, res) => {
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(Number(req.params.id));
  if (!e) return res.json({ ok: false, error: '申请不存在' });
  const { action } = req.body || {};
  const now = Date.now();
  let ns = e.status;
  if (action === 'approve') ns = 'trial';       // 通过 → 试鉴定（完成 N 单自动转正）
  else if (action === 'approve_direct') ns = 'approved';
  else if (action === 'reject') ns = 'suspended';
  else if (action === 'suspend') ns = 'suspended';
  else return res.json({ ok: false, error: 'action 不合法' });
  db.prepare('UPDATE experts SET status=?, reviewed_at=? WHERE id=?').run(ns, now, e.id);
  notify(e.user_id, 'system', '专家入驻审核结果', `您的鉴号专家申请（${action === 'reject' ? '未通过' : action === 'approve_direct' ? '已签约入驻' : '通过考核，进入试鉴定阶段'}）。`);
  res.json({ ok: true, data: { status: ns } });
});

export default router;
