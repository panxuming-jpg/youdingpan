import { reactive } from 'vue';
import { api, getToken, setToken } from './api.js';

export const store = reactive({
  ready: false,
  token: getToken(),
  user: null,
  unread: 0,
});

export async function initStore() {
  if (store.token) {
    try {
      store.user = await api('/me');
    } catch {
      store.token = '';
      store.user = null;
      setToken('');
    }
  }
  store.ready = true;
  if (store.user) refreshUnread();
}

export function setAuth(token, user) {
  setToken(token);
  store.token = token;
  store.user = user;
  refreshUnread();
}

export function logout() {
  setToken('');
  store.token = '';
  store.user = null;
  store.unread = 0;
}

export async function refreshUnread() {
  if (!store.token) return;
  try {
    const d = await api('/messages', { query: { page: 1, size: 1 } });
    store.unread = d.unread || 0;
  } catch { /* 静默失败 */ }
}
