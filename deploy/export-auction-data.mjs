// Export auction data only (auctions / bids / auction_orders + related users & wallets)
// to a JSON file. Run on the dev machine during packaging.
//
// Usage: node deploy/export-auction-data.mjs <output.json>
//
// The crawled game data (goods / price_history / monitor_tasks / ...) is NOT
// exported, so importing this file on the server can never overwrite it.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2];
if (!outPath) {
  console.error('usage: node export-auction-data.mjs <output.json>');
  process.exit(1);
}
const dbPath = path.join(__dirname, '..', 'server', 'data', 'app.db');
const db = new DatabaseSync(dbPath);

const auctions = db.prepare('SELECT * FROM auctions').all();
const auctionIds = auctions.map(a => a.id);

let bids = [];
let orders = [];
if (auctionIds.length) {
  const ph = auctionIds.map(() => '?').join(',');
  bids = db.prepare(`SELECT * FROM bids WHERE auction_id IN (${ph})`).all(...auctionIds);
  orders = db.prepare(`SELECT * FROM auction_orders WHERE auction_id IN (${ph})`).all(...auctionIds);
}

// Related users (sellers / winners / bidders / buyers) and their wallets
const userIds = new Set();
for (const a of auctions) {
  if (a.seller_id != null) userIds.add(a.seller_id);
  if (a.winner_id != null) userIds.add(a.winner_id);
}
for (const b of bids) if (b.user_id != null) userIds.add(b.user_id);
for (const o of orders) {
  if (o.buyer_id != null) userIds.add(o.buyer_id);
  if (o.seller_id != null) userIds.add(o.seller_id);
}
const users = [];
const wallets = [];
for (const uid of userIds) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (u) users.push(u);
  const w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(uid);
  if (w) wallets.push(w);
}

// Attach game/server names so the importer can remap ids if the server's games
// table uses different ids.
const gameNameCache = new Map();
const serverNameCache = new Map();
function gameName(id) {
  if (id == null) return null;
  if (!gameNameCache.has(id)) {
    gameNameCache.set(id, db.prepare('SELECT name FROM games WHERE id=?').get(id)?.name ?? null);
  }
  return gameNameCache.get(id);
}
function serverName(id) {
  if (id == null) return null;
  if (!serverNameCache.has(id)) {
    serverNameCache.set(id, db.prepare('SELECT name FROM game_servers WHERE id=?').get(id)?.name ?? null);
  }
  return serverNameCache.get(id);
}
const auctionsEx = auctions.map(a => ({ ...a, __game_name: gameName(a.game_id), __server_name: serverName(a.server_id) }));

const payload = {
  schema: 'youdingpan-auction-data',
  exported_at: Date.now(),
  users,
  wallets,
  auctions: auctionsEx,
  bids,
  orders,
};
fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(`[auction-export] ${auctions.length} auctions, ${bids.length} bids, ${orders.length} orders, ${users.length} users -> ${outPath}`);
