import { Router } from 'express';
import { db, parseJSON } from '../db.js';

const r = Router();

export function shapeGame(g, withServers = true) {
  const out = {
    id: g.id,
    name: g.name,
    short_name: g.short_name || g.name,
    pinyin: g.pinyin || '',
    tags: parseJSON(g.tags, []),
    category: g.category,
    status: g.status,
  };
  if (withServers) {
    out.servers = db.prepare('SELECT id, name, type FROM game_servers WHERE game_id=? ORDER BY id').all(g.id);
  }
  return out;
}

r.get('/games', (req, res) => {
  const rows = db.prepare('SELECT * FROM games WHERE status=1 ORDER BY id').all();
  // 各游戏在售商品数（用于前端游戏 tab 展示/排序）
  const counts = db.prepare(`SELECT game_id, COUNT(*) AS c FROM goods WHERE status='on' GROUP BY game_id`).all();
  const countMap = new Map(counts.map(x => [x.game_id, x.c]));
  const data = rows.map(g => ({ ...shapeGame(g), goods_count: countMap.get(g.id) || 0 }));
  res.json({ ok: true, data });
});

export default r;
