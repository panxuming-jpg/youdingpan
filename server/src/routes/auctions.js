import { Router } from 'express';
import { db, parseJSON } from '../db.js';
import { authRequired } from '../middleware.js';
import { calcDeposit, scanAndSettle, notify, getWallet, freeze } from '../engine/auction.js';
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

// 我的订单（买家视角）
r.get('/my/orders', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.title AS auction_title, a.images AS auction_images, u.nickname AS seller_name, u.phone AS seller_phone
    FROM auction_orders o JOIN auctions a ON a.id=o.auction_id JOIN users u ON u.id=o.seller_id
    WHERE o.buyer_id=? ORDER BY o.created_at DESC
  `).all(req.user.id);
  res.json({
    ok: true, data: rows.map(o => ({
      id: o.id,
      auction_id: o.auction_id,
      auction_title: o.auction_title,
      images: parseJSON(o.auction_images, []),
      seller_name: o.seller_name || `用户${String(o.seller_phone).slice(-4)}`,
      amount: o.amount,
      status: o.status,
      paid_at: o.paid_at,
      confirmed_at: o.confirmed_at,
      created_at: o.created_at,
    })),
  });
});

// 模拟付款（买家）
r.post('/orders/:id/pay', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_payment') return res.json({ ok: false, error: '订单状态不允许付款' });

  const wallet = getWallet(req.user.id);
  if (wallet.balance < o.amount) return res.json({ ok: false, error: '余额不足' });

  const now = Date.now();
  db.prepare(`UPDATE auction_orders SET status='pending_confirm', paid_at=? WHERE id=?`).run(now, o.id);
  db.prepare('UPDATE wallets SET balance=balance-? WHERE user_id=?').run(o.amount, req.user.id);
  const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(o.auction_id);
  notify(o.seller_id, 'auction', '买家已付款', `「${a.title}」买家已完成付款，请等待平台交割换绑。`);
  res.json({ ok: true, data: { id: o.id, status: 'pending_confirm' } });
});

// 确认收货（买家）
r.post('/orders/:id/confirm', authRequired, (req, res) => {
  const o = db.prepare('SELECT * FROM auction_orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.json({ ok: false, error: '订单不存在' });
  if (o.buyer_id !== req.user.id) return res.json({ ok: false, error: '无权操作此订单' });
  if (o.status !== 'pending_confirm') return res.json({ ok: false, error: '订单状态不允许确认收货' });

  const now = Date.now();
  db.prepare(`UPDATE auction_orders SET status='completed', confirmed_at=? WHERE id=?`).run(now, o.id);
  db.prepare(`UPDATE auctions SET status='completed' WHERE id=?`).run(o.auction_id);
  // 解冻卖家货款（模拟扣除手续费后打款）
  const fee = Math.max(1, Math.round(o.amount * 0.05 * 100) / 100); // 5% 手续费
  const net = o.amount - fee;
  db.prepare('UPDATE wallets SET balance=balance+? WHERE user_id=?').run(net, o.seller_id);
  const a = db.prepare('SELECT title FROM auctions WHERE id=?').get(o.auction_id);
  notify(o.seller_id, 'auction', '交易完成', `「${a.title}」交易已完成，货款 ¥${net.toFixed(2)}（已扣除手续费 ¥${fee.toFixed(2)}）已到账。`);
  notify(o.buyer_id, 'auction', '交易完成', `「${a.title}」交易已完成，感谢您的购买。`);
  res.json({ ok: true, data: { id: o.id, status: 'completed' } });
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

// 钱包查询
r.get('/wallet', authRequired, (req, res) => {
  const w = getWallet(req.user.id);
  res.json({ ok: true, data: { balance: w.balance, frozen: w.frozen } });
});

export default r;
