// Import auction data into the server database.
// Writes ONLY users / wallets / auctions / bids / auction_orders.
// Never touches goods / price_history / monitor_tasks / favorites / ...
// Idempotent: safe to run again on repeated deploys.
//
// Usage: node deploy/import-auction-data.mjs [data.json] [app.db]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.argv[2] || path.join(__dirname, 'auction-data.json');
const dbPath = process.argv[3] || path.join(__dirname, '..', 'server', 'data', 'app.db');

if (!fs.existsSync(dataFile)) {
  console.log('[auction-import] no auction-data.json, skip');
  process.exit(0);
}
const expectedDataDir = path.resolve(path.join(__dirname, '..', 'server', 'data'));
if (!fs.existsSync(dbPath)) {
  // First deploy: initialize schema + seed data via the app db module
  // (only when the target is the standard server/data location), then import.
  if (path.resolve(path.dirname(dbPath)) === expectedDataDir) {
    console.log('[auction-import] first deploy: initializing empty database before import...');
    await import(pathToFileURL(path.join(__dirname, '..', 'server', 'src', 'db.js')).href);
  } else {
    console.log('[auction-import] target database does not exist at custom path, skip');
    process.exit(0);
  }
}

const payload = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

const stats = { users: 0, wallets: 0, auctions: 0, bids: 0, orders: 0 };

// ---------- users: remap on id/phone conflicts ----------
const userIdMap = new Map();
for (const u of payload.users || []) {
  if (u.phone) {
    const byPhone = db.prepare('SELECT id FROM users WHERE phone=?').get(u.phone);
    if (byPhone) { userIdMap.set(u.id, byPhone.id); continue; }
  }
  const byId = db.prepare('SELECT id FROM users WHERE id=?').get(u.id);
  if (!byId) {
    db.prepare(`INSERT INTO users (id, phone, nickname, avatar, email, is_admin, push_channels, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(u.id, u.phone, u.nickname ?? '', u.avatar ?? '', u.email ?? '', u.is_admin ?? 0,
        u.push_channels ?? '["inapp"]', u.created_at ?? Date.now());
    userIdMap.set(u.id, u.id);
  } else {
    const r = db.prepare(`INSERT INTO users (phone, nickname, avatar, email, is_admin, push_channels, created_at)
      VALUES (?,?,?,?,0,?,?)`)
      .run(u.phone, u.nickname ?? '', u.avatar ?? '', u.email ?? '',
        u.push_channels ?? '["inapp"]', u.created_at ?? Date.now());
    userIdMap.set(u.id, Number(r.lastInsertRowid));
  }
  stats.users++;
}
const mapUser = id => (id == null ? null : (userIdMap.get(id) ?? id));

// ---------- wallets: only create when missing on remote ----------
for (const w of payload.wallets || []) {
  const rid = mapUser(w.user_id);
  if (db.prepare('SELECT id FROM wallets WHERE user_id=?').get(rid)) continue;
  db.prepare('INSERT INTO wallets (user_id, balance, frozen, created_at) VALUES (?,?,?,?)')
    .run(rid, w.balance ?? 10000, w.frozen ?? 0, w.created_at ?? Date.now());
  stats.wallets++;
}

// ---------- auctions: verify/remap game & server ids ----------
const auctionIdMap = new Map();
const qGame = db.prepare('SELECT id FROM games WHERE id=?');
const qGameByName = db.prepare('SELECT id FROM games WHERE name=?');
const qServer = db.prepare('SELECT id FROM game_servers WHERE id=?');
const qServerByName = db.prepare('SELECT id FROM game_servers WHERE game_id=? AND name=?');
const qAuction = db.prepare('SELECT id FROM auctions WHERE id=?');

for (const a of payload.auctions || []) {
  let gameId = a.game_id;
  if (!qGame.get(gameId)) {
    if (a.__game_name) gameId = qGameByName.get(a.__game_name)?.id ?? gameId;
  }
  if (!qGame.get(gameId)) {
    console.warn(`[auction-import] skip "${a.title}": game not found on remote`);
    continue;
  }
  let serverId = a.server_id ?? null;
  if (serverId != null && !qServer.get(serverId)) {
    serverId = a.__server_name ? (qServerByName.get(gameId, a.__server_name)?.id ?? null) : null;
  }

  const params = [
    mapUser(a.seller_id), gameId, serverId, a.title, a.description ?? '', a.images ?? '[]',
    a.start_price, a.increment, a.reserve_price ?? null, a.deposit_rate ?? 0.1, a.duration,
    a.start_at, a.end_at, a.extend_count ?? 0, a.max_extend ?? 10, a.status,
    mapUser(a.winner_id), a.final_price ?? null, a.created_at ?? Date.now(),
  ];
  const colNames = `seller_id, game_id, server_id, title, description, images, start_price,
    increment, reserve_price, deposit_rate, duration, start_at, end_at, extend_count,
    max_extend, status, winner_id, final_price, created_at`;

  if (qAuction.get(a.id)) {
    // Same id already exists: distinguish "already imported from this file"
    // (title + created_at + start_price match) from a genuine id collision.
    const ex = db.prepare('SELECT title, created_at, start_price FROM auctions WHERE id=?').get(a.id);
    if (ex.title === a.title && ex.created_at === a.created_at && ex.start_price === a.start_price) {
      auctionIdMap.set(a.id, a.id); // already synced, skip
      continue;
    }
    const r = db.prepare(`INSERT INTO auctions (${colNames}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(...params);
    auctionIdMap.set(a.id, Number(r.lastInsertRowid));
  } else {
    db.prepare(`INSERT INTO auctions (id, ${colNames}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(a.id, ...params);
    auctionIdMap.set(a.id, a.id);
  }
  stats.auctions++;
}
const mapAuction = id => (id == null ? null : (auctionIdMap.get(id) ?? id));

// ---------- bids: skip duplicates ----------
const qBidDup = db.prepare(
  'SELECT id FROM bids WHERE auction_id=? AND user_id=? AND amount=? AND created_at=?'
);
for (const b of payload.bids || []) {
  const aid = mapAuction(b.auction_id);
  const uid = mapUser(b.user_id);
  if (!qAuction.get(aid)) continue;
  if (qBidDup.get(aid, uid, b.amount, b.created_at)) continue;
  db.prepare('INSERT INTO bids (auction_id, user_id, amount, created_at) VALUES (?,?,?,?)')
    .run(aid, uid, b.amount, b.created_at);
  stats.bids++;
}

// ---------- auction_orders: skip duplicates ----------
const qOrderDup = db.prepare(
  'SELECT id FROM auction_orders WHERE auction_id=? AND buyer_id=? AND amount=? AND created_at=?'
);
for (const o of payload.orders || []) {
  const aid = mapAuction(o.auction_id);
  const buyer = mapUser(o.buyer_id);
  const seller = mapUser(o.seller_id);
  if (qOrderDup.get(aid, buyer, o.amount, o.created_at)) continue;

  let newId;
  if (!db.prepare('SELECT id FROM auction_orders WHERE id=?').get(o.id)) {
    db.prepare(`INSERT INTO auction_orders
      (id, auction_id, buyer_id, seller_id, amount, status, paid_at, confirmed_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(o.id, aid, buyer, seller, o.amount, o.status, o.paid_at ?? null, o.confirmed_at ?? null, o.created_at);
    newId = o.id;
  } else {
    const r = db.prepare(`INSERT INTO auction_orders
      (auction_id, buyer_id, seller_id, amount, status, paid_at, confirmed_at, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(aid, buyer, seller, o.amount, o.status, o.paid_at ?? null, o.confirmed_at ?? null, o.created_at);
    newId = Number(r.lastInsertRowid);
  }
  // Keep auction.order_id valid after id remapping
  db.prepare('UPDATE auctions SET order_id=? WHERE id=?').run(newId, aid);
  stats.orders++;
}

console.log(`[auction-import] done: +${stats.auctions} auctions, +${stats.bids} bids, +${stats.orders} orders, +${stats.users} users, +${stats.wallets} wallets (crawled goods untouched)`);
