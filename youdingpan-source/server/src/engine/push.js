import { db, parseJSON } from '../db.js';
import { pushToUser } from './sse.js';

// 同一用户 1 分钟最多 1 次实时推送（站内消息仍完整入库）
const PUSH_INTERVAL = 60_000;
const lastPushAt = new Map();

function notifyContent(type, goods, extra = {}) {
  const price = `¥${goods.price.toFixed(2)}`;
  switch (type) {
    case 'new':
      return { title: `新上架 · ${goods.game_name}`, content: `[${goods.platform_name}] ${goods.title}，现价 ${price}` };
    case 'drop':
      return { title: `降价提醒 · ${goods.game_name}`, content: `[${goods.platform_name}] ${goods.title} 降价 ¥${extra.dropAmount.toFixed(2)}，现价 ${price}` };
    case 'off':
      return { title: `已下架 · ${goods.game_name}`, content: `[${goods.platform_name}] ${goods.title} 已下架，最后价格 ${price}` };
    default:
      return { title: '通知', content: '' };
  }
}

function matchTasks(type, goods, dropAmount) {
  const tasks = db.prepare(`SELECT * FROM monitor_tasks WHERE status='on' AND game_id=?`).all(goods.game_id);
  const matched = [];
  for (const t of tasks) {
    const platforms = parseJSON(t.platforms, []);
    const notifyTypes = parseJSON(t.notify_types, []);
    if (!platforms.includes(goods.platform)) continue;
    if (!notifyTypes.includes(type)) continue;
    if (t.server_id) {
      const s = db.prepare('SELECT name FROM game_servers WHERE id=?').get(t.server_id);
      if (s && s.name !== goods.server_name) continue;
    }
    if (t.price_min != null && goods.price < t.price_min) continue;
    if (t.price_max != null && goods.price > t.price_max) continue;
    if (type === 'drop' && (t.drop_threshold || 0) > 0 && dropAmount < t.drop_threshold) continue;
    matched.push(t);
  }
  return matched;
}

/**
 * 事件分发：匹配任务 -> 去重 -> 写站内通知 -> 实时推送（限频）
 */
export function dispatchEvent(type, goods, extra = {}) {
  const tasks = matchTasks(type, goods, extra.dropAmount || 0);
  for (const t of tasks) {
    // 同一商品同类型事件对同一用户只推送一次
    const r = db.prepare('INSERT OR IGNORE INTO notified_events (user_id, goods_id, type) VALUES (?,?,?)')
      .run(t.user_id, goods.id, type);
    if (r.changes === 0) continue;

    const { title, content } = notifyContent(type, goods, extra);
    db.prepare('INSERT INTO notifications (user_id, task_id, goods_id, type, title, content, is_read, created_at) VALUES (?,?,?,?,?,?,0,?)')
      .run(t.user_id, t.id, goods.id, type, title, content, Date.now());
    db.prepare('UPDATE monitor_tasks SET trigger_count=trigger_count+1 WHERE id=?').run(t.id);

    // 实时推送限频：1 分钟内不重复打扰（消息仍保留在消息中心）
    const last = lastPushAt.get(t.user_id) || 0;
    if (Date.now() - last >= PUSH_INTERVAL) {
      lastPushAt.set(t.user_id, Date.now());
      pushToUser(t.user_id);
    }
  }
}
