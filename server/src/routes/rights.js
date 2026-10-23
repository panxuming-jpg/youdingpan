/**
 * 买家追账号维权路由（PRD 模块 F）：
 * 申请 → 平台审核（冻结卖家资金）→ 生成民事起诉状/报案材料包 → 回填司法进度 → 结案解冻
 * 管理端：审核、签发交易存证证明、手动解冻
 */
import { Router } from 'express';
import { db, parseJSON } from '../db.js';
import { authRequired, adminRequired } from '../middleware.js';
import { notify, getWallet, freeze, unfreeze } from '../engine/auction.js';
import { evidencePack, buildComplaintHtml, buildReportPackHtml, buildCertHtml, composeFacts } from '../engine/rights.js';

const router = Router();
const round2 = v => Math.round(v * 100) / 100;

// 案卷状态分组：filed 之后（含）才可见完整实名/证据
const ADVANCED = ['filed', 'docs_ready', 'submitted', 'in_progress', 'closed_done'];
const OPEN = ['pending_verify', 'filed', 'docs_ready', 'submitted', 'in_progress'];

function addEvent(caseId, actor, type, content) {
  db.prepare('INSERT INTO rights_events (case_id, actor, type, content, created_at) VALUES (?,?,?,?,?)')
    .run(caseId, actor, type, content, Date.now());
}

// 取案卷并校验归属（买家本人；管理员单独走 admin 路由）
function mustOwnCase(req, res) {
  const c = db.prepare('SELECT * FROM rights_cases WHERE id=?').get(Number(req.params.id));
  if (!c) { res.json({ ok: false, error: '维权案不存在' }); return null; }
  if (c.buyer_id !== req.user.id && !req.user.is_admin) {
    res.status(403).json({ ok: false, error: '无权操作该维权案' }); return null;
  }
  return c;
}

function shapeCase(c) {
  return {
    id: c.id, order_id: c.order_id, buyer_id: c.buyer_id, seller_id: c.seller_id,
    status: c.status, claim_types: parseJSON(c.claim_types, ['civil']),
    recover_at: c.recover_at, scenario: c.scenario || '', loss: c.loss,
    contacted_seller: !!c.contacted_seller, materials: parseJSON(c.materials, []),
    reject_reason: c.reject_reason || '', freeze_amount: c.freeze_amount,
    court_name: c.court_name || '', case_no: c.case_no || '', result: c.result || '',
    created_at: c.created_at, updated_at: c.updated_at,
  };
}

function orderSummary(orderId) {
  const o = db.prepare(`SELECT o.*, g.name AS game_name, l.server_name FROM self_orders o
    LEFT JOIN games g ON g.id=o.game_id LEFT JOIN listings l ON l.id=o.listing_id WHERE o.id=?`).get(orderId);
  if (!o) return null;
  return {
    id: o.id, order_no: o.order_no, game_name: o.game_name, server_name: o.server_name,
    price: o.price, total: o.total, status: o.status,
    created_at: o.created_at, paid_at: o.paid_at, completed_at: o.completed_at,
  };
}

// ---------- 买家端 ----------

// 发起维权申请
router.post('/rights/apply', authRequired, (req, res) => {
  const { order_id, recover_at, scenario, loss, contacted_seller, materials, claim_types } = req.body || {};
  const o = db.prepare('SELECT * FROM self_orders WHERE id=? AND buyer_id=?').get(Number(order_id), req.user.id);
  if (!o) return res.json({ ok: false, error: '订单不存在或不属于您' });
  if (o.status !== 'completed') return res.json({ ok: false, error: '仅已完成订单可申请追账号维权' });
  const lossNum = Number(loss);
  if (!Number.isFinite(lossNum) || lossNum <= 0) return res.json({ ok: false, error: '损失金额须大于 0' });
  const ct = (Array.isArray(claim_types) && claim_types.length ? claim_types : ['civil'])
    .filter(x => ['civil', 'criminal', 'compensation'].includes(x));
  if (!ct.length) return res.json({ ok: false, error: '维权方式无效（civil/criminal/compensation）' });
  const active = db.prepare(`SELECT id FROM rights_cases WHERE order_id=? AND status NOT IN ('closed','closed_done')`).get(o.id);
  if (active) return res.json({ ok: false, error: '该订单已有进行中的维权案' });

  const now = Date.now();
  const mats = Array.isArray(materials) ? materials.map(m => String(m).slice(0, 300)).slice(0, 20) : [];
  const r = db.prepare(`INSERT INTO rights_cases (order_id, buyer_id, seller_id, status, claim_types, recover_at, scenario, loss,
    contacted_seller, materials, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(o.id, o.buyer_id, o.seller_id, 'pending_verify', JSON.stringify(ct), Number(recover_at) || now,
      String(scenario || '').slice(0, 1000), lossNum, contacted_seller ? 1 : 0, JSON.stringify(mats), now, now);
  const caseId = Number(r.lastInsertRowid);
  addEvent(caseId, 'buyer', 'created', `买家提交维权申请：订单 ${o.order_no}，主张损失 ¥${lossNum.toFixed(2)}，方式 ${ct.join('/')}`);
  notify(o.buyer_id, 'system', '维权申请已提交', `订单 ${o.order_no} 的追账号维权申请已提交，平台将在 72 小时内完成证据审核。`);
  notify(o.seller_id, 'system', '维权通知', `您的订单 ${o.order_no} 被买家发起追账号维权，平台正在审核证据。如审核成立，您的钱包等额资金将被冻结配合调查。`);
  const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
  for (const a of admins) notify(a.id, 'system', '维权待审核', `维权案 #${caseId}（订单 ${o.order_no}）待审核，请核验证据链。`);
  res.json({ ok: true, data: { case_id: caseId, status: 'pending_verify' } });
});

// 我的维权案列表（含订单摘要）
router.get('/rights/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM rights_cases WHERE buyer_id=? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ ok: true, data: rows.map(c => ({ ...shapeCase(c), order_summary: orderSummary(c.order_id) })) });
});

// 维权案详情
router.get('/rights/:id', authRequired, (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  const filed = ADVANCED.includes(c.status);
  const seller = db.prepare('SELECT real_name, id_card, phone FROM users WHERE id=?').get(c.seller_id);
  const maskName = n => (n ? n[0] + '*'.repeat(Math.max(1, n.length - 1)) : '');
  const maskId = id => (id && id.length > 8 ? id.slice(0, 4) + '*'.repeat(id.length - 8) + id.slice(-4) : id || '');
  const docs = db.prepare('SELECT id, kind, title, created_at FROM rights_documents WHERE case_id=? ORDER BY id DESC').all(c.id);
  res.json({ ok: true, data: {
    case: shapeCase(c),
    order_summary: orderSummary(c.order_id),
    events: db.prepare('SELECT * FROM rights_events WHERE case_id=? ORDER BY created_at').all(c.id),
    evidence: evidencePack(c, { full: filed }),
    documents: docs,
    seller_real: filed
      ? { real_name: seller?.real_name || '', id_card: seller?.id_card || '', phone: seller?.phone || '' }
      : { real_name: maskName(seller?.real_name), id_card: maskId(seller?.id_card), phone: seller?.phone ? seller.phone.slice(0, 3) + '****' + seller.phone.slice(-4) : '' },
  } });
});

// 补充自证材料
router.post('/rights/:id/evidence', authRequired, (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  if (!['pending_verify', 'filed'].includes(c.status)) return res.json({ ok: false, error: '当前状态不可补充证据' });
  const add = Array.isArray(req.body?.materials) ? req.body.materials.map(m => String(m).slice(0, 300)) : [];
  if (!add.length) return res.json({ ok: false, error: '请上传至少一张自证图片' });
  const merged = [...parseJSON(c.materials, []), ...add].slice(0, 40);
  db.prepare('UPDATE rights_cases SET materials=?, updated_at=? WHERE id=?').run(JSON.stringify(merged), Date.now(), c.id);
  addEvent(c.id, 'buyer', 'evidence', `买家补充自证材料 ${add.length} 项`);
  res.json({ ok: true, data: { materials: merged } });
});

// 生成民事起诉状
router.post('/rights/:id/generate-complaint', authRequired, async (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  if (!['filed', 'docs_ready', 'submitted', 'in_progress'].includes(c.status)) {
    return res.json({ ok: false, error: '维权案审核通过后才能生成起诉状' });
  }
  try {
    const factsEdit = await composeFacts(c, { edit: String(req.body?.facts_edit || '').trim() });
    const html = buildComplaintHtml(c, {
      factsEdit,
      claims: Array.isArray(req.body?.claims) ? req.body.claims : null,
      courtName: String(req.body?.court_name || c.court_name || '').trim(),
      extraClaim: String(req.body?.extra_claim || '').trim(),
    });
    const now = Date.now();
    const r = db.prepare(`INSERT INTO rights_documents (case_id, kind, title, html, created_at) VALUES (?, 'complaint', '民事起诉状', ?, ?)`)
      .run(c.id, html, now);
    const upd = { updated_at: now };
    if (req.body?.court_name) upd.court_name = String(req.body.court_name).slice(0, 100);
    if (c.status === 'filed') upd.status = 'docs_ready';
    const sets = Object.keys(upd).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE rights_cases SET ${sets} WHERE id=?`).run(...Object.values(upd), c.id);
    addEvent(c.id, 'buyer', 'doc_generated', `已生成民事起诉状（文书 #${r.lastInsertRowid}）`);
    notify(c.buyer_id, 'system', '起诉状已生成', `维权案 #${c.id} 民事起诉状已生成，请打印签字后向受诉法院递交。`);
    res.json({ ok: true, data: { doc_id: Number(r.lastInsertRowid) } });
  } catch (e) {
    res.json({ ok: false, error: e.message || '起诉状生成失败' });
  }
});

// 生成报案材料包
router.post('/rights/:id/generate-report-pack', authRequired, async (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  if (!['filed', 'docs_ready', 'submitted', 'in_progress'].includes(c.status)) {
    return res.json({ ok: false, error: '维权案审核通过后才能生成报案材料包' });
  }
  const stationId = Number(req.body?.station_id);
  const station = stationId ? db.prepare('SELECT * FROM police_stations WHERE id=?').get(stationId) : null;
  if (stationId && !station) return res.json({ ok: false, error: '递交单位（派出所）不存在，请先检索选择' });
  try {
    const html = buildReportPackHtml(c, station);
    const r = db.prepare(`INSERT INTO rights_documents (case_id, kind, title, html, created_at) VALUES (?, 'report_pack', ?, ?, ?)`)
      .run(c.id, `报案材料包（${station?.name || '待选单位'}）`, html, Date.now());
    db.prepare(`UPDATE rights_cases SET status=CASE WHEN status='filed' THEN 'docs_ready' ELSE status END, updated_at=? WHERE id=?`).run(Date.now(), c.id);
    addEvent(c.id, 'buyer', 'doc_generated', `已生成报案材料包（文书 #${r.lastInsertRowid}，递交单位：${station?.name || '未选择'}）`);
    notify(c.buyer_id, 'system', '报案材料包已生成', `维权案 #${c.id} 报案材料包已生成，请打印并附证据原件到派出所递交。`);
    res.json({ ok: true, data: { doc_id: Number(r.lastInsertRowid) } });
  } catch (e) {
    res.json({ ok: false, error: e.message || '报案材料包生成失败' });
  }
});

// 获取文书正文（前端新窗口打印/下载）
router.get('/rights/:id/documents/:docId', authRequired, (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  const doc = db.prepare('SELECT * FROM rights_documents WHERE id=? AND case_id=?').get(Number(req.params.docId), c.id);
  if (!doc) return res.json({ ok: false, error: '文书不存在' });
  res.json({ ok: true, data: { title: doc.title, html: doc.html } });
});

// 买家回填司法进度
router.post('/rights/:id/progress', authRequired, (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  const { stage, note, case_no, result } = req.body || {};
  if (!['submitted', 'in_progress', 'closed_done'].includes(stage)) return res.json({ ok: false, error: 'stage 须为 submitted/in_progress/closed_done' });
  if (!['filed', 'docs_ready', 'submitted', 'in_progress'].includes(c.status)) return res.json({ ok: false, error: '当前状态不可回填进度' });
  if (stage === 'submitted' && !String(case_no || '').trim()) return res.json({ ok: false, error: '已递交需填写案号（case_no）' });
  const now = Date.now();
  const patch = { status: stage, updated_at: now };
  if (case_no) patch.case_no = String(case_no).slice(0, 60);
  if (result) patch.result = String(result).slice(0, 500);
  if (stage === 'closed_done' && !patch.result) patch.result = String(note || '已结案');
  const sets = Object.keys(patch).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE rights_cases SET ${sets} WHERE id=?`).run(...Object.values(patch), c.id);
  addEvent(c.id, 'buyer', 'progress', `进度回填：${stage}${case_no ? `，案号 ${case_no}` : ''}${note ? `，备注：${note}` : ''}`);
  // 结案：解除卖家冻结
  if (stage === 'closed_done' && c.freeze_amount > 0) {
    unfreeze(c.seller_id, c.freeze_amount);
    addEvent(c.id, 'system', 'unfrozen', `维权结案，卖家钱包冻结 ¥${c.freeze_amount.toFixed(2)} 已解除`);
    notify(c.seller_id, 'system', '冻结解除', `维权案 #${c.id} 已结案，您钱包被冻结的 ¥${c.freeze_amount.toFixed(2)} 已解除恢复可用。`);
  }
  notify(c.buyer_id, 'system', '维权进度更新', `维权案 #${c.id} 状态已更新为 ${stage}。`);
  res.json({ ok: true, data: { status: stage } });
});

// 撤销维权案
router.post('/rights/:id/cancel', authRequired, (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  if (['closed', 'closed_done'].includes(c.status)) return res.json({ ok: false, error: '维权案已结束' });
  db.prepare(`UPDATE rights_cases SET status='closed', updated_at=? WHERE id=?`).run(Date.now(), c.id);
  addEvent(c.id, 'buyer', 'cancelled', '买家撤销维权案');
  // 防御：审核成立后撤销时同步解冻卖家资金，避免冻结悬空
  if (c.freeze_amount > 0) {
    unfreeze(c.seller_id, c.freeze_amount);
    addEvent(c.id, 'system', 'unfrozen', `维权案撤销，卖家钱包冻结 ¥${c.freeze_amount.toFixed(2)} 已解除`);
    notify(c.seller_id, 'system', '冻结解除', `维权案 #${c.id} 已被买家撤销，您钱包冻结资金已解除。`);
  }
  notify(c.seller_id, 'system', '维权案撤销', `维权案 #${c.id}（买家 ${req.user.nickname}）已撤销。`);
  res.json({ ok: true, data: { status: 'closed' } });
});

// 申请平台签发《交易存证证明》（实际内容由管理端签发）
router.post('/rights/:id/cert', authRequired, (req, res) => {
  const c = mustOwnCase(req, res);
  if (!c) return;
  if (['closed', 'closed_done', 'rejected'].includes(c.status)) return res.json({ ok: false, error: '维权案已结束，无法申请存证证明' });
  addEvent(c.id, 'buyer', 'cert_request', '买家申请平台签发《交易存证证明》');
  const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
  for (const a of admins) notify(a.id, 'system', '存证证明待签发', `维权案 #${c.id} 买家申请签发《交易存证证明》，请在管理端签发。`);
  res.json({ ok: true, data: { requested: true } });
});

// ---------- 管理端 ----------

// 维权案全量列表
router.get('/admin/rights', authRequired, adminRequired, (req, res) => {
  const status = String(req.query.status || '');
  const rows = status
    ? db.prepare('SELECT * FROM rights_cases WHERE status=? ORDER BY id DESC LIMIT 200').all(status)
    : db.prepare('SELECT * FROM rights_cases ORDER BY id DESC LIMIT 200').all();
  res.json({ ok: true, data: rows.map(c => ({ ...shapeCase(c), order_summary: orderSummary(c.order_id) })) });
});

// 审核：成立（冻结卖家等额资金）/ 驳回
router.post('/admin/rights/:id/verify', authRequired, adminRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM rights_cases WHERE id=?').get(Number(req.params.id));
  if (!c) return res.json({ ok: false, error: '维权案不存在' });
  if (c.status !== 'pending_verify') return res.json({ ok: false, error: '该维权案已审核' });
  const { pass, reject_reason, freeze_amount } = req.body || {};
  const now = Date.now();
  if (pass === true || pass === 'true' || pass === 1) {
    const want = round2(Number(freeze_amount) > 0 ? Number(freeze_amount) : c.loss);
    const w = getWallet(c.seller_id);
    const actual = round2(Math.min(w.balance, want)); // 余额不足时按可用余额部分冻结
    if (actual > 0) freeze(c.seller_id, actual);
    db.prepare(`UPDATE rights_cases SET status='filed', freeze_amount=?, updated_at=? WHERE id=?`).run(actual, now, c.id);
    addEvent(c.id, 'admin', 'verified', `审核成立，已立案（filed）；冻结卖家钱包 ¥${actual.toFixed(2)}${actual < want ? `（申请 ¥${want.toFixed(2)}，卖家余额不足部分冻结）` : ''}`);
    notify(c.buyer_id, 'system', '维权审核成立', `维权案 #${c.id} 审核成立，已冻结卖家等额资金 ¥${actual.toFixed(2)}。您现在可生成民事起诉状或报案材料包。`);
    notify(c.seller_id, 'system', '维权审核成立', `维权案 #${c.id} 平台审核成立，您的钱包资金 ¥${actual.toFixed(2)} 已被冻结配合维权调查，结案后自动解除。`);
    res.json({ ok: true, data: { status: 'filed', freeze_amount: actual } });
  } else if (pass === false || pass === 'false' || pass === 0) {
    if (!String(reject_reason || '').trim()) return res.json({ ok: false, error: '驳回必须填写理由' });
    db.prepare(`UPDATE rights_cases SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`)
      .run(String(reject_reason).slice(0, 500), now, c.id);
    addEvent(c.id, 'admin', 'rejected', `审核驳回：${reject_reason}`);
    notify(c.buyer_id, 'system', '维权审核驳回', `维权案 #${c.id} 审核未通过：${reject_reason}。可补充证据后重新申请。`);
    res.json({ ok: true, data: { status: 'rejected' } });
  } else {
    res.json({ ok: false, error: 'pass 字段必须为 true/false' });
  }
});

// 签发《交易存证证明》
router.post('/admin/rights/:id/cert-issue', authRequired, adminRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM rights_cases WHERE id=?').get(Number(req.params.id));
  if (!c) return res.json({ ok: false, error: '维权案不存在' });
  const custom = String(req.body?.content || '').trim();
  let html = custom;
  if (!html) {
    try { html = buildCertHtml(c); } catch (e) { return res.json({ ok: false, error: e.message || '存证证明生成失败' }); }
  }
  const r = db.prepare(`INSERT INTO rights_documents (case_id, kind, title, html, created_at) VALUES (?, 'cert', '交易存证证明', ?, ?)`)
    .run(c.id, html, Date.now());
  addEvent(c.id, 'admin', 'cert_issued', `平台已签发《交易存证证明》（文书 #${r.lastInsertRowid}）`);
  notify(c.buyer_id, 'system', '存证证明已签发', `维权案 #${c.id} 的《交易存证证明》已签发，请在维权案详情中查看下载。`);
  res.json({ ok: true, data: { doc_id: Number(r.lastInsertRowid) } });
});

// 手动解除卖家冻结
router.post('/admin/rights/:id/unfreeze', authRequired, adminRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM rights_cases WHERE id=?').get(Number(req.params.id));
  if (!c) return res.json({ ok: false, error: '维权案不存在' });
  if (!(c.freeze_amount > 0)) return res.json({ ok: false, error: '该维权案无冻结资金' });
  const w = getWallet(c.seller_id);
  const back = round2(Math.min(w.frozen, c.freeze_amount)); // 下限保护：最多解冻当前冻结额
  if (back > 0) unfreeze(c.seller_id, back);
  db.prepare('UPDATE rights_cases SET freeze_amount=0, updated_at=? WHERE id=?').run(Date.now(), c.id);
  addEvent(c.id, 'admin', 'unfrozen', `管理端解除卖家钱包冻结 ¥${back.toFixed(2)}`);
  notify(c.seller_id, 'system', '冻结解除', `维权案 #${c.id} 的钱包冻结资金 ¥${back.toFixed(2)} 已由平台解除。`);
  res.json({ ok: true, data: { unfrozen: back } });
});

export default router;
