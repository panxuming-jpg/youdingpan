import { Router } from 'express';
import { db, parseJSON, getSettingNum, fundLog } from '../db.js';
import { authRequired } from '../middleware.js';
import { calcDeposit, scanAndSettle, notify, freeze, settleOrder } from '../engine/auction.js';
import { createPayOrder, getPayOrder, shapePayOrder } from '../pay.js';
import { searchAuctionIds, addAuction } from '../search.js';

const r = Router();
// auth 路由已在 /api 全局挂载 authOptional，此处仅对操作类接口逐个加 authRequired，
// 拍卖市场浏览（列表/详情）保持公开

const DURATIONS = [12 * 3600, 24 * 3600, 48 * 3600, 72 * 3600]; // 秒
const EXTEND_THRESHOLD = 5 * 60 * 1000; // 结束前 5 分钟
const EXTEND_STEP = 5 * 60 * 1000;      // 每次延时 5 分钟

function shapeAuction(a, withBids = false) {
  const game = db.prepare('SELECT name, short_name FROM games WHERE id=?').get(a.game_id) || {};
  const server = a.server_id ? db.prepare('SELECT name FROM game_servers WHERE id=?').get(a.server_id) : null;
  const seller = db.prepare('SELECT nickname, phone FROM users WHERE id=?').get(a.seller_id) || {};
  const bids = withBids
    ? db.prepare(`SELECT b.*, u.nickname, u.phone FROM bids b JOIN users u ON u.id=b.user_id WHERE b.auction_id=? ORDER BY b.created_at DESC LIMIT 50`).all(a.id)
    : [];
  const top = db.prepare('SELECT amount, user_id FROM bids WHERE auction_id=? ORDER BY amount DESC, created_at ASC LIMIT 1').get(a.id);
  const bidCount = db.prepare('SELECT COUNT(*) AS c FROM bids WHERE auction_id=?').get(a.id).c;
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    images: parseJSON(a.images, []),
    game_id: a.game_id,
    game_name: game.short_name || game.name || '',
    server_id: a.server_id,
    server_name: server ? server.name : null,
    seller_id: a.seller_id,
    seller_name: seller.nickname || `用户${String(seller.phone || '').slice(-4)}`,
    start_price: a.start_price,
    increment: a.increment,
    reserve_price: a.reserve_price,
    deposit: calcDeposit(a.start_price, a.deposit_rate),
    duration: a.duration,
    start_at: a.start_at,
    end_at: a.end_at,
    extend_count: a.extend_count,
    max_extend: a.max_extend,
    status: a.status,
    winner_id: a.winner_id,
    final_price: a.final_price,
    order_id: a.order_id,
    created_at: a.created_at,
    current_price: top ? top.amount : null,
    current_leader_id: top ? top.user_id : null,
    bid_count: bidCount,
    bids: bids.map(b => ({
      id: b.id,
      user_id: b.user_id,
      nickname: b.nickname || `用户${String(b.phone).slice(-4)}`,
      amount: b.amount,
      created_at: b.created_at,
    })),
  };
}

// 列表（含筛选）
r.get('/auctions', (req, res) => {
  const { game_id, status, keyword, sort } = req.query;
  const where = ['1=1'];
  const params = [];
  if (game_id) { where.push('a.game_id=?'); params.push(Number(game_id)); }
  if (status && ['active', 'sold', 'failed', 'cancelled'].includes(status)) {
    where.push('a.status=?'); params.push(status);
  }
  // 关键词检索：走内存倒排索引（标题分词：英文整词/中文 bigram）。
  // query 按空格分组，多组（多个 term）同时命中标题的拍卖 match_level 更高、优先透出，
  // 再透出只命中部分组的拍卖，同级内按用户选择的排序键。
  let levelCase = '';
  if (keyword) {
    const { ids, levelOf } = searchAuctionIds(keyword);
    if (!ids.length) return res.json({ ok: true, data: [] });
    where.push(`a.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
    levelCase = `CASE a.id ${[...levelOf.entries()].map(([id, lv]) => `WHEN ${Number(id)} THEN ${lv}`).join(' ')} ELSE 0 END`;
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  let orderSql = 'ORDER BY a.created_at DESC';
  if (sort === 'ending') orderSql = `ORDER BY CASE WHEN a.status='active' THEN a.end_at ELSE 9999999999999 END ASC`;
  if (sort === 'price_asc') orderSql = 'ORDER BY COALESCE((SELECT MAX(amount) FROM bids WHERE auction_id=a.id), a.start_price) ASC';
  if (sort === 'price_desc') orderSql = 'ORDER BY COALESCE((SELECT MAX(amount) FROM bids WHERE auction_id=a.id), a.start_price) DESC';
  if (levelCase) orderSql = `ORDER BY ${levelCase} DESC, ` + orderSql.replace(/^ORDER BY\s*/, '');

  const rows = db.prepare(`
    SELECT a.* FROM auctions a ${whereSql} ${orderSql} LIMIT 200
  `).all(...params);
  res.json({ ok: true, data: rows.map(a => shapeAuction(a, false)) });
});

// 详情
r.get('/auctions/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM auctions WHERE id=?').get(Number(req.params.id));
  if (!a) return res.json({ ok: false, error: '拍卖不存在' });
  res.json({ ok: true, data: shapeAuction(a, true) });
});

// 发布拍卖
r.post('/auctions', authRequired, (req, res) => {
  const { game_id, server_id, title, description, images, start_price, increment, reserve_price, duration } = req.body || {};
  if (!title || !String(title).trim()) return res.json({ ok: false, error: '请填写拍卖标题' });
  const game = db.prepare('SELECT id FROM games WHERE id=? AND status=1').get(Number(game_id));
  if (!game) return res.json({ ok: false, error: '请选择游戏' });
  if (server_id) {
    const srv = db.prepare('SELECT id FROM game_servers WHERE id=? AND game_id=?').get(Number(server_id), game.id);
    if (!srv) return res.json({ ok: false, error: '请选择正确的区服' });
  }
  const sp = Number(start_price);
  if (!Number.isFinite(sp) || sp < 0) return res.json({ ok: false, error: '起拍价必须大于等于 0' });
  const inc = Number(increment);
  if (!Number.isFinite(inc) || inc <= 0) return res.json({ ok: false, error: '加价幅度必须大于 0' });
  const rp = reserve_price === '' || reserve_price == null ? null : Number(reserve_price);
  if (rp != null && (!Number.isFinite(rp) || rp <= sp)) return res.json({ ok: false, error: '保留价必须大于起拍价' });
  const dur = Number(duration);
  if (!DURATIONS.includes(dur)) return res.json({ ok: false, error: '拍卖时长必须是 12/24/48/72 小时' });

  const now = Date.now();
  const ins = db.prepare(`INSERT INTO auctions
    (seller_id, game_id, server_id, title, description, images, start_price, increment, reserve_price, duration, start_at, end_at, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`)
    .run(req.user.id, game.id, server_id ? Number(server_id) : null, String(title).trim().slice(0, 80),
      String(description || '').slice(0, 1000), JSON.stringify(Array.isArray(images) ? images.slice(0, 6) : []),
      sp, inc, rp, dur, now, now + dur * 1000, now);
  const a = db.prepare('SELECT * FROM auctions WHERE id=?').get(ins.lastInsertRowid);
  addAuction(a.id, a.title); // 增量写入拍卖倒排索引
  res.json({ ok: true, data: shapeAuction(a, false) });
});

// 出价
r.post('/auctions/:id/bid', authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM auctions WHERE id=?').get(Number(req.params.id));
  if (!a) return res.json({ ok: false, error: '拍卖不存在' });
  if (a.status !== 'active') return res.json({ ok: false, error: '拍卖已结束' });
  if (a.seller_id === req.user.id) return res.json({ ok: false, error: '不能对自己的拍卖出价' });

  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.json({ ok: false, error: '出价金额无效' });

  const top = db.prepare('SELECT amount, user_id FROM bids WHERE auction_id=? ORDER BY amount DESC, created_at ASC LIMIT 1').get(a.id);
  const minBid = top ? top.amount + a.increment : a.start_price;
  if (amount < minBid) return res.json({ ok: false, error: `出价不能低于 ¥${minBid.toFixed(2)}` });

  const deposit = calcDeposit(a.start_price, a.deposit_rate);
  // 同一拍卖同一买家只冻结一次保证金（重复出价不重复缴纳，未中标者拍卖结束时统一退回）
  const myBidCount = db.prepare('SELECT COUNT(*) AS c FROM bids WHERE auction_id=? AND user_id=?').get(a.id, req.user.id).c;
  if (myBidCount === 0 && !freeze(req.user.id, deposit)) {
    return res.json({ ok: false, error: '余额不足，无法缴纳保证金' });
  }

  const now = Date.now();
  let newEndAt = a.end_at;
  let extendCount = a.extend_count;
  // 延时规则：结束前 5 分钟内出价，自动延时 5 分钟（最多 10 次）
  if (a.end_at - now <= EXTEND_THRESHOLD && a.extend_count < a.max_extend) {
    newEndAt = a.end_at + EXTEND_STEP;
    extendCount += 1;
  }
  db.prepare('UPDATE auctions SET end_at=?, extend_count=? WHERE id=?').run(newEndAt, extendCount, a.id);
  db.prepare('INSERT INTO bids (auction_id, user_id, amount, created_at) VALUES (?,?,?,?)').run(a.id, req.user.id, amount, now);

  const updated = db.prepare('SELECT * FROM auctions WHERE id=?').get(a.id);
  const shaped = shapeAuction(updated, true);
  // 实时推送给出价者（前端出价成功提示）和卖家
  notify(a.seller_id, 'auction', '新出价提醒', `您的拍卖「${a.title}」收到新出价 ¥${amount.toFixed(2)}，当前领先价 ¥${shaped.current_price?.toFixed(2)}`);
  scanAndSettle(); // 出价后立即检查是否触发结算（理论上不会，防御性调用）
  res.json({ ok: true, data: shaped });
});

// 我的拍卖列表（卖家视角）
r.get('/my/auctions', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM auctions WHERE seller_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ ok: true, data: rows.map(a => shapeAuction(a, false)) });
});

// 我的竞拍（买家视角）
r.get('/my/bids', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT a.* FROM auctions a JOIN bids b ON b.auction_id=a.id WHERE b.user_id=? ORDER BY b.created_at DESC
  `).all(req.user.id);
  res.json({ ok: true, data: rows.map(a => shapeAuction(a, false)) });
});

// 拍卖订单公共字段（买家/卖家视角共用）
function shapeOrder(o, extra = {}) {
  return {
    id: o.id,
    auction_id: o.auction_id,
    auction_title: o.auction_title,
    images: parseJSON(o.auction_images, []),
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
    ...extra,
  };
}

// 我的订单（买家视角）
r.get('/my/orders', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.title AS auction_title, a.images AS auction_images, u.nickname AS seller_name, u.phone AS seller_phone
    FROM auction_orders o JOIN auctions a ON a.id=o.auction_id JOIN users u ON u.id=o.seller_id
    WHERE o.buyer_id=? ORDER BY o.created_at DESC
  `).all(req.user.id);
  res.json({
    ok: true,
    data: rows.map(o => shapeOrder(o, {
      seller_name: o.seller_name || `用户${String(o.seller_phone).slice(-4)}`,
    })),
  });
});

// 我的售出订单（卖家视角）
r.get('/my/sale-orders', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.title AS auction_title, a.images AS auction_images, u.nickname AS buyer_name, u.phone AS buyer_phone
    FROM auction_orders o JOIN auctions a ON a.id=o.auction_id JOIN users u ON u.id=o.buyer_id
    WHERE o.seller_id=? ORDER BY o.created_at DESC
  `).all(req.user.id);
  res.json({
    ok: true,
    data: rows.map(o => shapeOrder(o, {
      buyer_name: o.buyer_name || `用户${String(o.buyer_phone).slice(-4)}`,
    })),
  });
});

// 买家支付：创建/复用担保支付单（资金进平台担保账户，不再从钱包扣款）
r.post('/orders/:id/pay', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_payment') return res.json({ ok: false, error: '订单状态不允许付款' });

  // 复用未过期的待支付单
  if (o.pay_order_no) {
    const exist = getPayOrder(o.pay_order_no);
    if (exist && exist.status === 'pending' && exist.expire_at > Date.now()) {
      return res.json({ ok: true, data: shapePayOrder(exist) });
    }
  }
  const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(o.auction_id);
  const order = createPayOrder({
    userId: req.user.id,
    scene: 'auction',
    refId: o.id,
    subject: `拍卖货款担保支付：${a?.title || `订单#${o.id}`}`,
    amount: o.amount,
  });
  db.prepare('UPDATE auction_orders SET pay_order_no=? WHERE id=?').run(order.order_no, o.id);
  res.json({ ok: true, data: shapePayOrder(order) });
});

// 卖家发货：填写物流公司与单号，订单转「待买家确认收货」
r.post('/orders/:id/ship', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.seller_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_ship') return res.json({ ok: false, error: '订单状态不允许发货' });

  const company = String(req.body?.ship_company || '').trim().slice(0, 30);
  const shipNo = String(req.body?.ship_no || '').trim().slice(0, 50);
  if (!company) return res.json({ ok: false, error: '请填写物流公司' });
  if (!shipNo) return res.json({ ok: false, error: '请填写物流单号' });

  const now = Date.now();
  const autoDays = getSettingNum('auto_confirm_days', 7);
  const autoConfirmAt = now + autoDays * 86_400_000;
  db.prepare(`UPDATE auction_orders SET status='pending_confirm', ship_company=?, ship_no=?, shipped_at=?, auto_confirm_at=? WHERE id=?`)
    .run(company, shipNo, now, autoConfirmAt, o.id);
  const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(o.auction_id);
  notify(o.buyer_id, 'auction', '卖家已发货', `「${a?.title}」卖家已发货（${company} ${shipNo}），请在收货后及时确认；${autoDays} 天内未确认将自动确认收货。`);
  res.json({ ok: true, data: { id: o.id, status: 'pending_confirm', auto_confirm_at: autoConfirmAt } });
});

// 确认收货（买家）：担保资金结算至卖家余额
r.post('/orders/:id/confirm', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_confirm') return res.json({ ok: false, error: '订单状态不允许确认收货' });
  settleOrder(o.id);
  res.json({ ok: true, data: { id: o.id, status: 'completed' } });
});

// 买家退款（仅未发货可申请，全额退款，交易关闭）
r.post('/orders/:id/refund', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_ship') return res.json({ ok: false, error: '卖家已发货，退款请走售后申诉' });

  const now = Date.now();
  db.prepare(`UPDATE auction_orders SET status='refunded', refunded_at=? WHERE id=?`).run(now, o.id);
  const refNo = o.pay_order_no || `ORDER${o.id}`;
  // 担保资金原路退回买家（模拟通道直接记账；真实支付调用渠道退款接口）
  fundLog({ userId: o.buyer_id, biz: 'refund', amount: o.amount, direction: 'in', refNo, remark: `拍卖订单 #${o.id} 未发货全额退款` });
  const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(o.auction_id);
  notify(o.buyer_id, 'auction', '退款成功', `「${a?.title}」订单已退款 ¥${o.amount.toFixed(2)}，资金将原路退回您的支付账户。`);
  notify(o.seller_id, 'auction', '订单已退款关闭', `「${a?.title}」买家申请了未发货退款，担保资金 ¥${o.amount.toFixed(2)} 已退回买家，订单关闭。`);
  res.json({ ok: true, data: { id: o.id, status: 'refunded' } });
});

// 买家售后申诉（待收货状态发起，平台介入仲裁，担保资金冻结）
r.post('/orders/:id/after-sale', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_confirm') return res.json({ ok: false, error: '当前状态不支持售后申诉' });
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (!reason) return res.json({ ok: false, error: '请填写售后申诉原因' });

  db.prepare(`UPDATE auction_orders SET status='after_sale', after_sale_reason=? WHERE id=?`).run(reason, o.id);
  const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(o.auction_id);
  notify(o.seller_id, 'auction', '买家发起售后', `「${a?.title}」买家发起售后申诉：${reason}。平台已冻结该笔担保资金，等待仲裁处理。`);
  notify(o.buyer_id, 'auction', '售后已受理', `「${a?.title}」售后申诉已提交，平台将介入仲裁，担保资金已冻结，请留意处理结果。`);
  res.json({ ok: true, data: { id: o.id, status: 'after_sale' } });
});

// 卖家取消拍卖（仅无出价时允许）
r.post('/auctions/:id/cancel', authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM auctions WHERE id=?').get(Number(req.params.id));
  if (!a) return res.json({ ok: false, error: '拍卖不存在' });
  if (a.seller_id !== req.user.id) return res.json({ ok: false, error: '无权操作此拍卖' });
  if (a.status !== 'active') return res.json({ ok: false, error: '拍卖已结束' });
  const bidCount = db.prepare('SELECT COUNT(*) AS c FROM bids WHERE auction_id=?').get(a.id).c;
  if (bidCount > 0) return res.json({ ok: false, error: '已有买家出价，禁止取消拍卖' });
  db.prepare(`UPDATE auctions SET status='cancelled' WHERE id=?`).run(a.id);
  res.json({ ok: true, data: { id: a.id, status: 'cancelled' } });
});

export default r;
