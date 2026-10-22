/**
 * 订单三方会话与证据链路由（PRD FR-E1/E2/E4）
 */
import { Router } from 'express';
import { db, parseJSON } from '../db.js';
import { authRequired } from '../middleware.js';
import { handleMessage, escalate, addEvidence } from '../engine/ai_service.js';

const router = Router();

function orderOf(req, res) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(Number(req.params.id));
  if (!o) { res.status(404).json({ ok: false, error: '订单不存在' }); return null; }
  if (o.buyer_id !== req.user.id && o.seller_id !== req.user.id && !req.user.is_admin) {
    res.status(403).json({ ok: false, error: '无权访问该订单会话' }); return null;
  }
  return o;
}

router.get('/orders/:id/messages', authRequired, (req, res) => {
  const o = orderOf(req, res);
  if (!o) return;
  const since = Number(req.query.since || 0);
  const rows = db.prepare('SELECT * FROM order_messages WHERE order_id=? AND id>? ORDER BY id').all(o.id, since);
  res.json({ ok: true, data: rows.map(m => ({ ...m, meta: parseJSON(m.meta_json, null) })) });
});

router.post('/orders/:id/messages', authRequired, async (req, res) => {
  const o = orderOf(req, res);
  if (!o) return;
  if (['completed', 'refunded', 'cancelled', 'compensated_closed'].includes(o.status)) {
    return res.json({ ok: false, error: '订单会话已归档（只读）' });
  }
  const content = String(req.body?.content || '').trim().slice(0, 1000);
  if (!content) return res.json({ ok: false, error: '消息不能为空' });
  const sender = o.buyer_id === req.user.id ? 'buyer' : o.seller_id === req.user.id ? 'seller' : 'system';
  if (sender === 'system') return res.json({ ok: false, error: '运营请使用工单处理' });
  const aiMsg = await handleMessage(o.id, sender, content);
  res.json({ ok: true, data: { reply: aiMsg } });
});

// 证据链（只可追加不可编辑，理赔与纠纷唯一依据）
router.get('/orders/:id/evidence', authRequired, (req, res) => {
  const o = orderOf(req, res);
  if (!o) return;
  const rows = db.prepare('SELECT * FROM evidence_chain WHERE order_id=? ORDER BY created_at').all(o.id);
  res.json({ ok: true, data: rows.map(e => ({ ...e, detail: parseJSON(e.detail_json, {}) })) });
});

// 升级人工（FR-E4）
router.post('/orders/:id/escalate', authRequired, (req, res) => {
  const o = orderOf(req, res);
  if (!o) return;
  const reason = String(req.body?.reason || '用户主动申请人工客服').slice(0, 200);
  escalate(o.id, reason);
  addEvidence(o.id, 'claim', o.buyer_id === req.user.id ? 'buyer' : 'seller', { escalated: reason });
  res.json({ ok: true });
});

// 风险事件列表（订单参与方可见）
router.get('/orders/:id/risks', authRequired, (req, res) => {
  const o = orderOf(req, res);
  if (!o) return;
  res.json({ ok: true, data: db.prepare('SELECT * FROM risk_events WHERE order_id=? ORDER BY created_at DESC').all(o.id) });
});

// 运营：风险事件总览
router.get('/admin/risk-events', authRequired, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ ok: false, error: '需要管理员权限' });
  const rows = db.prepare(`SELECT r.*, o.order_no FROM risk_events r LEFT JOIN self_orders o ON o.id=r.order_id
    ORDER BY r.id DESC LIMIT 200`).all();
  res.json({ ok: true, data: rows });
});

export default router;
