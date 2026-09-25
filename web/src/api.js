import router from './router.js';

const TOKEN_KEY = 'ydp_token';
const BASE = '/api';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function buildQuery(query) {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * 统一请求封装：自动携带 token，成功时直接返回后端 data 字段，
 * 失败（HTTP 错误或 ok:false）抛出 ApiError；401 时清除凭据并跳转登录页。
 */
export async function api(path, { method = 'GET', body, query } = {}) {
  const url = BASE + path + buildQuery(query);
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('网络异常，请稍后重试', 0);
  }

  if (res.status === 401) {
    setToken('');
    if (router.currentRoute.value.path !== '/login') {
      router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
    }
    throw new ApiError('登录状态已失效，请重新登录', 401);
  }

  let json = null;
  try { json = await res.json(); } catch { /* 忽略非 JSON 响应 */ }

  if (!res.ok) throw new ApiError(json?.error || `请求失败（${res.status}）`, res.status);
  if (!json || json.ok !== true) throw new ApiError(json?.error || '请求失败', res.status);
  return json.data;
}
