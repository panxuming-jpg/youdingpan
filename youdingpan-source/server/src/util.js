import crypto from 'node:crypto';

const SECRET = process.env.APP_SECRET || 'you-dan-pan-demo-secret-2026';

export function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url').slice(0, 24);
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url').slice(0, 24);
  if (sig !== expect) return null;
  try {
    const { uid } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return uid;
  } catch {
    return null;
  }
}

export function maskSeller(name) {
  if (!name) return '匿名卖家';
  if (name.length <= 2) return name[0] + '*';
  return name[0] + '*'.repeat(Math.min(name.length - 2, 3)) + name[name.length - 1];
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
