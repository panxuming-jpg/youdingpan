import { Router } from 'express';
import { db, PLATFORMS, getSetting, setSetting, extendMembership, fundLog } from '../db.js';
import { adminRequired } from '../middleware.js';
import { addBalance } from '../engine/auction.js';
import { shapeGame } from './games.js';

const r = Router();
r.use('/admin', adminRequired);

// 后台可配置项（key 白名单，防止任意写入 settings 表）
const SETTING_KEYS = [
  'free_view_limit', 'view_count_mode', 'member_price', 'member_days', 'member_benefits',
  'order_fee_rate', 'auto_confirm_days', 'withdraw_min', 'withdraw_fee_rate', 'withdraw_free_threshold',
];
const SETTING_LABELS = {
  free_view_limit: '免费用户可查看商品详情数量上限',
  view_count_mode: '查看计数模式（permanent 永久累计 / daily 每日重置）',
  member_price: '会员月卡价格（元）',
  member_days: '会员单次订阅天数',
  member_benefits: '会员权益说明',
  order_fee_rate: '拍卖订单平台手续费率',
  auto_confirm_days: '发货后自动确认收货天数',
  withdraw_min: '单笔最低提现金额',
  withdraw_fee_rate: '提现手续费率',
  withdraw_free_threshold: '提现免手续费门槛（0=不启用）',
};

r.get('/admin/overview', (_req, res) => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const platforms = db.prepare('SELECT * FROM platform_status').all().map(p => ({
    platform: p.platform,
    name: p.name || PLATFORMS[p.platform],
    status: p.status,
    running: !!p.running,
    last_run: p.last_run,
    total_ok: p.total_ok,
    last_ok: db.prepare('SELECT ok_count FROM crawl_logs WHERE platform=? ORDER BY created_at DESC LIMIT 1').get(p.platform)?.ok_count ?? 0,
    last_fail: db.prepare('SELECT fail_count FROM crawl_logs WHERE platform=? ORDER BY created_at DESC LIMIT 1').get(p.platform)?.fail_count ?? 0,
  }));
  // 担保中资金 = 待发货 + 待确认收货 + 售后中 订单金额合计（平台托管未结算）
  const escrow = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM auction_orders WHERE status IN ('pending_ship','pending_confirm','after_sale')`).get().s;
  const payToday = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM pay_orders WHERE status='paid' AND paid_at>=?`).get(todayStart.getTime()).s;
  res.json({
    ok: true,
    data: {
      goods_total: db.prepare(`SELECT COUNT(*) AS c FROM goods WHERE status='on'`).get().c,
      tasks_online: db.prepare(`SELECT COUNT(*) AS c FROM monitor_tasks WHERE status='on'`).get().c,
      triggers_today: db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE created_at>=?').get(todayStart.getTime()).c,
      users_total: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      members_total: db.prepare('SELECT COUNT(*) AS c FROM users WHERE member_expire_at>?').get(Date.now()).c,
      pay_today: payToday,
      escrow_total: escrow,
      withdraw_pending: db.prepare(`SELECT COUNT(*) AS c FROM withdraw_orders WHERE status='pending'`).get().c,
      platforms,
      recent_logs: db.prepare('SELECT id, platform, ok_count, fail_count, message, created_at FROM crawl_logs ORDER BY created_at DESC LIMIT 20').all(),
    },
  });
});

r.get('/admin/logs', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = 20;
  const where = [];
  const params = [];
  if (req.query.platform && PLATFORMS[req.query.platform]) { where.push('platform=?'); params.push(req.query.platform); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM crawl_logs ${whereSql}`).get(...params).c;
  const list = db.prepare(`SELECT * FROM crawl_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size);
  res.json({ ok: true, data: { total, list } });
});

r.post('/admin/platform/:platform/toggle', (req, res) => {
  const p = db.prepare('SELECT * FROM platform_status WHERE platform=?').get(req.params.platform);
  if (!p) return res.json({ ok: false, error: '平台不存在' });
  const running = req.body?.running ? 1 : 0;
  db.prepare('UPDATE platform_status SET running=? WHERE platform=?').run(running, p.platform);
  res.json({ ok: true, data: { platform: p.platform, running: !!running } });
});

r.get('/admin/games', (_req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY sort_order, id').all();
  res.json({ ok: true, data: rows.map(g => shapeGame(g)) });
});

r.post('/admin/games', (req, res) => {
  const { name, short_name, pinyin, tags, category } = req.body || {};
  if (!name?.trim()) return res.json({ ok: false, error: '游戏名称不能为空' });
  const exist = db.prepare('SELECT id FROM games WHERE name=?').get(name.trim());
  if (exist) return res.json({ ok: false, error: '游戏已存在' });
  const ins = db.prepare('INSERT INTO games (name, short_name, pinyin, tags, category, status, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(name.trim(), (short_name || name).trim(), pinyin || '', JSON.stringify(Array.isArray(tags) ? tags : []), category || '手游', Date.now());
  res.json({ ok: true, data: shapeGame(db.prepare('SELECT * FROM games WHERE id=?').get(ins.lastInsertRowid)) });
});

r.put('/admin/games/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '游戏不存在' });
  const b = req.body || {};
  const name = b.name?.trim() || g.name;
  const short_name = b.short_name?.trim() || g.short_name;
  const pinyin = b.pinyin ?? g.pinyin;
  const tags = JSON.stringify(Array.isArray(b.tags) ? b.tags : JSON.parse(g.tags));
  const category = b.category || g.category;
  const status = b.status !== undefined ? (b.status ? 1 : 0) : g.status;
  db.prepare('UPDATE games SET name=?, short_name=?, pinyin=?, tags=?, category=?, status=? WHERE id=?')
    .run(name, short_name, pinyin, tags, category, status, g.id);
  res.json({ ok: true, data: shapeGame(db.prepare('SELECT * FROM games WHERE id=?').get(g.id)) });
});

r.delete('/admin/games/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '游戏不存在' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM goods WHERE game_id=?').get(g.id).c;
  if (used > 0) return res.json({ ok: false, error: `该游戏下有 ${used} 个商品，无法删除（可停用）` });
  db.prepare('DELETE FROM games WHERE id=?').run(g.id);
  db.prepare('DELETE FROM game_servers WHERE game_id=?').run(g.id);
  res.json({ ok: true, data: { ok: true } });
});

r.post('/admin/games/:id/servers', (req, res) => {
  const g = db.prepare('SELECT id FROM games WHERE id=?').get(Number(req.params.id));
  if (!g) return res.json({ ok: false, error: '游戏不存在' });
  const { name, type } = req.body || {};
  if (!name?.trim()) return res.json({ ok: false, error: '区服名称不能为空' });
  const ins = db.prepare('INSERT INTO game_servers (game_id, name, type) VALUES (?,?,?)').run(g.id, name.trim(), type || '官服');
  res.json({ ok: true, data: db.prepare('SELECT * FROM game_servers WHERE id=?').get(ins.lastInsertRowid) });
});

r.delete('/admin/servers/:id', (req, res) => {
  db.prepare('DELETE FROM game_servers WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true, data: { ok: true } });
});

r.get('/admin/announcements', (_req, res) => {
  res.json({ ok: true, data: db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all() });
});

r.post('/admin/announcements', (req, res) => {
  const { title, content } = req.body || {};
  if (!title?.trim()) return res.json({ ok: false, error: '标题不能为空' });
  const ins = db.prepare('INSERT INTO announcements (title, content, created_at) VALUES (?,?,?)')
    .run(title.trim(), content || '', Date.now());
  res.json({ ok: true, data: db.prepare('SELECT * FROM announcements WHERE id=?').get(ins.lastInsertRowid) });
});

r.delete('/admin/announcements/:id', (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true, data: { ok: true } });
});

// ---------- 系统设置 ----------
r.get('/admin/settings', (_req, res) => {
  res.json({
    ok: true,
    data: SETTING_KEYS.map(key => ({ key, label: SETTING_LABELS[key], value: getSetting(key, '') })),
  });
});

r.put('/admin/settings', (req, res) => {
  const updates = req.body?.settings;
  if (!updates || typeof updates !== 'object') return res.json({ ok: false, error: '参数格式不正确' });
  for (const [key, value] of Object.entries(updates)) {
    if (!SETTING_KEYS.includes(key)) continue; // 白名单外忽略
    if (key === 'view_count_mode' && !['permanent', 'daily'].includes(String(value))) {
      return res.json({ ok: false, error: 'view_count_mode 仅支持 permanent / daily' });
    }
    setSetting(key, String(value).slice(0, 200));
  }
  res.json({ ok: true, data: { ok: true } });
});

// ---------- 会员管理 ----------
r.get('/admin/members', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.phone, u.nickname, u.is_admin, u.member_expire_at, u.created_at,
      (SELECT COUNT(*) FROM goods_view_logs v WHERE v.user_id=u.id) AS view_count,
      (SELECT COUNT(*) FROM pay_orders p WHERE p.user_id=u.id AND p.scene='member' AND p.status='paid') AS member_orders
    FROM users u ORDER BY u.member_expire_at DESC, u.id DESC LIMIT 200
  `).all();
  const now = Date.now();
  res.json({
    ok: true,
    data: rows.map(u => ({
      id: u.id,
      phone: u.phone,
      nickname: u.nickname || `用户${String(u.phone).slice(-4)}`,
      is_admin: !!u.is_admin,
      is_member: (u.member_expire_at || 0) > now,
      member_expire_at: u.member_expire_at || 0,
      view_count: u.view_count,
      member_orders: u.member_orders,
      created_at: u.created_at,
    })),
  });
});

// 手动开通/顺延会员（补单、客诉补偿场景）
r.post('/admin/members/:userId/grant', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(Number(req.params.userId));
  if (!u) return res.json({ ok: false, error: '用户不存在' });
  const days = Number(req.body?.days);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) return res.json({ ok: false, error: '天数无效' });
  const expire = extendMembership(u.id, days);
  fundLog({ userId: u.id, biz: 'member_grant', amount: 0, direction: 'in', remark: `后台手动开通会员 ${days} 天（操作人：${req.user.phone}）` });
  res.json({ ok: true, data: { user_id: u.id, member_expire_at: expire } });
});

// ---------- 支付流水 ----------
r.get('/admin/pay-orders', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.scene && ['member', 'auction'].includes(req.query.scene)) { where.push('p.scene=?'); params.push(req.query.scene); }
  if (req.query.status && ['pending', 'paid', 'closed', 'timeout'].includes(req.query.status)) { where.push('p.status=?'); params.push(req.query.status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT p.*, u.phone, u.nickname FROM pay_orders p JOIN users u ON u.id=p.user_id
    ${whereSql} ORDER BY p.created_at DESC LIMIT 200
  `).all(...params);
  res.json({
    ok: true,
    data: rows.map(o => ({
      order_no: o.order_no,
      user_id: o.user_id,
      user_name: o.nickname || `用户${String(o.phone).slice(-4)}`,
      phone: o.phone,
      scene: o.scene,
      ref_id: o.ref_id,
      subject: o.subject,
      amount: o.amount,
      channel: o.channel,
      status: o.status,
      expire_at: o.expire_at,
      paid_at: o.paid_at,
      created_at: o.created_at,
    })),
  });
});

// ---------- 拍卖交易管理（全量订单 + 担保资金状态） ----------
r.get('/admin/auction-orders', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('o.status=?'); params.push(String(req.query.status)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT o.*, a.title AS auction_title,
      bu.nickname AS buyer_nick, bu.phone AS buyer_phone,
      su.nickname AS seller_nick, su.phone AS seller_phone
    FROM auction_orders o
    JOIN auctions a ON a.id=o.auction_id
    JOIN users bu ON bu.id=o.buyer_id
    JOIN users su ON su.id=o.seller_id
    ${whereSql} ORDER BY o.created_at DESC LIMIT 200
  `).all(...params);
  const name = (nick, phone) => nick || `用户${String(phone).slice(-4)}`;
  res.json({
    ok: true,
    data: rows.map(o => ({
      id: o.id,
      auction_id: o.auction_id,
      auction_title: o.auction_title,
      buyer: name(o.buyer_nick, o.buyer_phone),
      seller: name(o.seller_nick, o.seller_phone),
      amount: o.amount,
      status: o.status,
      pay_order_no: o.pay_order_no || '',
      ship_company: o.ship_company || '',
      ship_no: o.ship_no || '',
      shipped_at: o.shipped_at,
      auto_confirm_at: o.auto_confirm_at,
      after_sale_reason: o.after_sale_reason || '',
      paid_at: o.paid_at,
      confirmed_at: o.confirmed_at,
      refunded_at: o.refunded_at,
      created_at: o.created_at,
    })),
  });
});

// ---------- 提现审核 ----------
r.get('/admin/withdraws', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status && ['pending', 'paid', 'rejected'].includes(req.query.status)) { where.push('w.status=?'); params.push(req.query.status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT w.*, u.phone, u.nickname FROM withdraw_orders w JOIN users u ON u.id=w.user_id
    ${whereSql} ORDER BY w.created_at DESC LIMIT 200
  `).all(...params);
  res.json({
    ok: true,
    data: rows.map(w => ({
      id: w.id,
      user_id: w.user_id,
      user_name: w.nickname || `用户${String(w.phone).slice(-4)}`,
      phone: w.phone,
      amount: w.amount,
      fee: w.fee,
      channel: w.channel,
      account: w.account,
      status: w.status,
      remark: w.remark || '',
      created_at: w.created_at,
      processed_at: w.processed_at,
    })),
  });
});

// 审核通过：标记已打款（真实环境在此调用微信/支付宝转账接口）
r.post('/admin/withdraws/:id/approve', (req, res) => {
  const w = db.prepare('SELECT * FROM withdraw_orders WHERE id=?').get(Number(req.params.id));
  if (!w) return res.json({ ok: false, error: '提现单不存在' });
  if (w.status !== 'pending') return res.json({ ok: false, error: '该提现单已处理' });
  db.prepare(`UPDATE withdraw_orders SET status='paid', processed_at=?, remark=? WHERE id=?`)
    .run(Date.now(), String(req.body?.remark || '审核通过，已打款').slice(0, 100), w.id);
  res.json({ ok: true, data: { id: w.id, status: 'paid' } });
});

// 驳回：退回用户余额并记流水
r.post('/admin/withdraws/:id/reject', (req, res) => {
  const w = db.prepare('SELECT * FROM withdraw_orders WHERE id=?').get(Number(req.params.id));
  if (!w) return res.json({ ok: false, error: '提现单不存在' });
  if (w.status !== 'pending') return res.json({ ok: false, error: '该提现单已处理' });
  const remark = String(req.body?.remark || '提现驳回').slice(0, 100);
  db.prepare(`UPDATE withdraw_orders SET status='rejected', processed_at=?, remark=? WHERE id=?`).run(Date.now(), remark, w.id);
  addBalance(w.user_id, w.amount); // 申请时已全额扣减（含手续费），驳回全额退回
  fundLog({ userId: w.user_id, biz: 'withdraw_reject', amount: w.amount, direction: 'in', refNo: `W${w.id}`, channel: w.channel, remark: `提现驳回退回：${remark}` });
  res.json({ ok: true, data: { id: w.id, status: 'rejected' } });
});

// ---------- 全量资金流水 ----------
r.get('/admin/fund-logs', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.biz) { where.push('l.biz=?'); params.push(String(req.query.biz)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT l.*, u.phone, u.nickname FROM fund_logs l LEFT JOIN users u ON u.id=l.user_id
    ${whereSql} ORDER BY l.created_at DESC LIMIT 300
  `).all(...params);
  res.json({
    ok: true,
    data: rows.map(l => ({
      id: l.id,
      user_id: l.user_id,
      user_name: l.user_id == null ? '平台' : (l.nickname || `用户${String(l.phone || '').slice(-4)}`),
      biz: l.biz,
      amount: l.amount,
      direction: l.direction,
      ref_no: l.ref_no,
      channel: l.channel,
      remark: l.remark,
      created_at: l.created_at,
    })),
  });
});

export default r;
