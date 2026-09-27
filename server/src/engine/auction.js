/**
 * 拍卖结算引擎：到期成交 / 流拍 / 付款超时自动取消 / 延时规则处理
 * 与采集引擎共用同一 SQLite 连接，通过定时器每 5 秒扫描一次到期拍卖
 */
import { db, parseJSON } from '../db.js';
import { pushToUser } from './sse.js';

const SETTLE_INTERVAL = 5000; // 5 秒扫描一次到期拍卖

// 写通知（拍卖相关）
function notify(userId, type, title, content) {
  db.prepare('INSERT INTO notifications (user_id, task_id, goods_id, type, title, content, is_read, created_at) VALUES (?,NULL,NULL,?,?,?,0,?)')
    .run(userId, type, title, content, Date.now());
  pushToUser(userId);
}

function getWallet(userId) {
  let w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
  if (!w) {
    db.prepare('INSERT INTO wallets (user_id, balance, frozen, created_at) VALUES (?,10000.0,0,?)').run(userId, Date.now());
    w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
  }
  return w;
}

// 冻结/解冻/扣款
function freeze(userId, amount) {
  const w = getWallet(userId);
  if (w.balance < amount) return false;
  db.prepare('UPDATE wallets SET balance=balance-?, frozen=frozen+? WHERE user_id=?').run(amount, amount, userId);
  return true;
}
function unfreeze(userId, amount) {
  db.prepare('UPDATE wallets SET balance=balance+?, frozen=frozen-? WHERE user_id=?').run(amount, amount, userId);
}
function deductFrozen(userId, amount) {
  db.prepare('UPDATE wallets SET frozen=frozen-? WHERE user_id=?').run(amount, userId);
}
function addBalance(userId, amount) {
  db.prepare('UPDATE wallets SET balance=balance+? WHERE user_id=?').run(amount, userId);
}

// 计算当前最高价与领先者
function topBid(auctionId) {
  return db.prepare('SELECT * FROM bids WHERE auction_id=? ORDER BY amount DESC, created_at ASC LIMIT 1').get(auctionId);
}

// 计算保证金（起拍价 × 10%）
export function calcDeposit(startPrice, rate = 0.1) {
  return Math.max(1, Math.round(startPrice * rate * 100) / 100);
}

// 处理单个到期拍卖
function settleAuction(a) {
  const now = Date.now();
  const top = topBid(a.id);

  if (!top) {
    // 无出价 → 流拍
    db.prepare(`UPDATE auctions SET status='failed', winner_id=NULL, final_price=NULL WHERE id=?`).run(a.id);
    notify(a.seller_id, 'auction', '拍卖流拍', `您的拍卖「${a.title}」已结束，无买家出价，已流拍。`);
    return;
  }

  // 检查保留价
  if (a.reserve_price && top.amount < a.reserve_price) {
    // 未达保留价 → 流拍，退回所有保证金
    db.prepare(`UPDATE auctions SET status='failed', winner_id=NULL, final_price=NULL WHERE id=?`).run(a.id);
    const allBids = db.prepare('SELECT DISTINCT user_id FROM bids WHERE auction_id=?').all(a.id);
    const deposit = calcDeposit(a.start_price, a.deposit_rate);
    for (const b of allBids) {
      unfreeze(b.user_id, deposit);
      notify(b.user_id, 'auction', '拍卖流拍', `您参与的「${a.title}」拍卖已流拍（未达保留价），保证金 ¥${deposit.toFixed(2)} 已退回。`);
    }
    notify(a.seller_id, 'auction', '拍卖流拍', `您的拍卖「${a.title}」已结束，最高出价 ¥${top.amount.toFixed(2)} 未达保留价 ¥${a.reserve_price.toFixed(2)}，已流拍。`);
    return;
  }

  // 成交
  const winner = db.prepare('SELECT id, nickname, phone FROM users WHERE id=?').get(top.user_id);
  const deposit = calcDeposit(a.start_price, a.deposit_rate);
  // 扣除成交者保证金（转入平台托管），退回其他竞拍者保证金
  deductFrozen(top.user_id, deposit);
  const losers = db.prepare('SELECT DISTINCT user_id FROM bids WHERE auction_id=? AND user_id != ?').all(a.id, top.user_id);
  for (const l of losers) {
    unfreeze(l.user_id, deposit);
    notify(l.user_id, 'auction', '竞拍失败', `「${a.title}」拍卖已结束，您未中标，保证金 ¥${deposit.toFixed(2)} 已退回。`);
  }

  // 生成订单
  const insOrder = db.prepare(`INSERT INTO auction_orders (auction_id, buyer_id, seller_id, amount, status, created_at) VALUES (?,?,?,?,'pending_payment',?)`)
    .run(a.id, top.user_id, a.seller_id, top.amount, now);

  db.prepare(`UPDATE auctions SET status='sold', winner_id=?, final_price=?, order_id=? WHERE id=?`)
    .run(top.user_id, top.amount, insOrder.lastInsertRowid, a.id);

  // 买家通知（15 分钟付款倒计时）
  notify(top.user_id, 'auction', '拍卖成交', `恭喜！您以 ¥${top.amount.toFixed(2)} 拍得「${a.title}」，请在 15 分钟内完成付款，逾期订单将自动取消并扣除保证金。`);
  notify(a.seller_id, 'auction', '拍卖成交', `您的拍卖「${a.title}」已成交，成交价 ¥${top.amount.toFixed(2)}，等待买家付款。`);
}

// 扫描并处理所有到期拍卖
function scanAndSettle() {
  const now = Date.now();
  const due = db.prepare(`SELECT * FROM auctions WHERE status='active' AND end_at <= ?`).all(now);
  for (const a of due) settleAuction(a);

  // 扫描超时未付款订单（15 分钟）
  const timeoutOrders = db.prepare(`
    SELECT o.*, a.title AS auction_title, a.start_price, a.deposit_rate
    FROM auction_orders o
    JOIN auctions a ON a.id = o.auction_id
    WHERE o.status='pending_payment' AND o.created_at <= ?
  `).all(now - 15 * 60 * 1000);

  for (const o of timeoutOrders) {
    const deposit = calcDeposit(o.start_price, o.deposit_rate);
    // 取消订单，扣除买家保证金给卖家
    db.prepare(`UPDATE auction_orders SET status='cancelled' WHERE id=?`).run(o.id);
    db.prepare(`UPDATE auctions SET status='cancelled' WHERE id=?`).run(o.auction_id);
    deductFrozen(o.buyer_id, deposit);
    addBalance(o.seller_id, deposit);
    notify(o.buyer_id, 'auction', '订单已取消', `您未在 15 分钟内付款，「${o.auction_title}」订单已自动取消，保证金 ¥${deposit.toFixed(2)} 已扣除并赔付给卖家。`);
    notify(o.seller_id, 'auction', '买家违约', `买家未按时付款，「${o.auction_title}」订单已取消，保证金 ¥${deposit.toFixed(2)} 已赔付到您的余额。`);
  }
}

export function startAuctionEngine() {
  setInterval(scanAndSettle, SETTLE_INTERVAL);
  console.log('[auction] 拍卖结算引擎已启动（5s 扫描间隔）');
}

// 导出供路由层实时调用（出价后检查是否需要立即结算）
export { scanAndSettle, notify, getWallet, freeze, unfreeze, calcDeposit as auctionDeposit };
