import { getToken } from './api.js';
import { refreshUnread } from './store.js';

let es = null;
const listeners = new Set();

export function onNotify(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function connectSSE() {
  const token = getToken();
  if (!token) { closeSSE(); return; }
  if (es) return;
  es = new EventSource(`/api/sse?token=${encodeURIComponent(token)}`);
  // 服务端推送事件名为 notify（数据体为空，仅作为"有新消息"信号）
  es.addEventListener('notify', () => {
    refreshUnread();
    for (const cb of listeners) {
      try { cb(); } catch { /* 忽略监听器异常 */ }
    }
  });
  es.onerror = () => { /* EventSource 自动重连 */ };
}

export function closeSSE() {
  if (es) { es.close(); es = null; }
}
