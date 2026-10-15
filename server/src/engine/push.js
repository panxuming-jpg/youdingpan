import { db, parseJSON } from '../db.js';
import { pushToUser } from './sse.js';
import { sendMail } from '../mailer.js';

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
    case 'fav_drop': {
      // 相对收藏时基线价的降幅（收藏后首次低于基线才触发，见 dispatchFavEvent）
      const base = extra.baseline;
      const baseTxt = base != null && base > goods.price
        ? `，较收藏时 ¥${base.toFixed(2)} 降 ¥${(base - goods.price).toFixed(2)}`
        : '';
      return { title: `收藏降价 · ${goods.game_name}`, content: `[${goods.platform_name}] ${goods.title} 现价 ${price}${baseTxt}` };
    }
    case 'fav_off':
      return { title: `收藏下架 · ${goods.game_name}`, content: `[${goods.platform_name}] ${goods.title} 已下架，最后价格 ${price}` };
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
    // 'all' = 全部平台：匹配任意来源平台
    if (!platforms.includes('all') && !platforms.includes(goods.platform)) continue;
    if (!notifyTypes.includes(type)) continue;
    if (t.server_id) {
      const s = db.prepare('SELECT name FROM game_servers WHERE id=?').get(t.server_id);
      if (s && s.name !== goods.server_name) continue;
    }
    if (t.price_min != null && goods.price < t.price_min) continue;
    if (t.price_max != null && goods.price > t.price_max) continue;
    // 关键词过滤：命中任一关键词（标题或区服，大小写不敏感）才触发；空配置=不过滤
    if (t.keywords) {
      const terms = String(t.keywords).split(/\s+/).filter(Boolean);
      if (terms.length) {
        const hay = `${goods.title || ''} ${goods.server_name || ''}`.toLowerCase();
        if (!terms.some(k => hay.includes(k.toLowerCase()))) continue;
      }
    }
    if (type === 'drop' && (t.drop_threshold || 0) > 0 && dropAmount < t.drop_threshold) continue;
    matched.push(t);
  }
  return matched;
}

// 实时推送限频：1 分钟内不重复打扰（消息仍保留在消息中心）
function throttledSsePush(userId) {
  const last = lastPushAt.get(userId) || 0;
  if (Date.now() - last >= PUSH_INTERVAL) {
    lastPushAt.set(userId, Date.now());
    pushToUser(userId);
  }
}

// 邮件渠道：任务级 channels / 用户级 push_channels 含 'email' 且用户已填邮箱时发送
function maybeEmail(userId, channels, title, content) {
  if (!channels.includes('email')) return;
  const u = db.prepare('SELECT email FROM users WHERE id=?').get(userId);
  if (!u?.email) return;
  sendMail(u.email, title, content); // 异步发送，失败仅记日志
}

/**
 * 任务事件分发：匹配任务 -> 去重 -> 写站内通知 -> 实时推送（限频）-> 邮件（可选渠道）
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

    throttledSsePush(t.user_id);
    maybeEmail(t.user_id, parseJSON(t.channels, ['inapp']), title, content);
  }
}

/**
 * 收藏商品事件分发（fav_drop / fav_off）：
 * - 面向开启了收藏监控（fav_price_watch.status='on'）的用户，与监控任务互不影响
 * - fav_drop 仅在现价低于收藏时基线价时触发；触发后基线更新为最新低价，下次降价继续提醒
 * - fav_off 同一商品对同一用户只提醒一次
 * - 邮件走用户级推送渠道 push_channels（个人中心配置）
 */
export function dispatchFavEvent(type, goods, extra = {}) {
  const watchers = db.prepare(
    `SELECT user_id, baseline_price FROM fav_price_watch WHERE goods_id=? AND status='on'`
  ).all(goods.id);
  for (const w of watchers) {
    if (type === 'fav_drop' && w.baseline_price != null && goods.price >= w.baseline_price) continue;

    const { title, content } = notifyContent(type, goods, { ...extra, baseline: w.baseline_price });
    db.prepare('INSERT INTO notifications (user_id, task_id, goods_id, type, title, content, is_read, created_at) VALUES (?,NULL,?,?,?,?,0,?)')
      .run(w.user_id, goods.id, type, title, content, Date.now());

    // fav_drop 以最新低价更新基线，下次降价后继续触发提醒
    if (type === 'fav_drop') {
      db.prepare('UPDATE fav_price_watch SET baseline_price=? WHERE user_id=? AND goods_id=?')
        .run(goods.price, w.user_id, goods.id);
    }

    throttledSsePush(w.user_id);
    const u = db.prepare('SELECT email, push_channels FROM users WHERE id=?').get(w.user_id);
    if (u?.email && parseJSON(u.push_channels, ['inapp']).includes('email')) {
      sendMail(u.email, title, content); // 异步发送，失败仅记日志
    }
  }
}
