// 与后端 db.js 中 PLATFORMS 保持一致（含聚合选项 all）
export const PLATFORMS = [
  { key: 'all', name: '全部平台' },
  { key: 'jiaoyimao', name: '交易猫' },
  { key: 'panzhi', name: '盼之代售' },
  { key: 'pangxie', name: '螃蟹账号' },
  { key: '7881', name: '7881' },
  { key: 'dd373', name: 'DD373' },
  { key: '5173', name: '5173' },
];

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.key, p.name]));

export function platformName(key) {
  return PLATFORM_MAP[key] || key;
}

// 监控类型 / 通知类型（与后端 tasks.js、messages.js 对齐）
export const NOTIFY_TYPES = [
  { key: 'new', label: '新上架' },
  { key: 'drop', label: '降价' },
  { key: 'off', label: '已下架' },
];

const NOTIFY_LABELS = { new: '新上架', drop: '降价', off: '已下架', system: '系统' };

export function notifyLabel(type) {
  return NOTIFY_LABELS[type] || '通知';
}

// 推送渠道（与后端 auth.js 对齐）
export const CHANNELS = [
  { key: 'inapp', label: '站内消息' },
  { key: 'wechat', label: '微信' },
  { key: 'email', label: '邮件' },
];

export function channelLabel(key) {
  return CHANNELS.find(c => c.key === key)?.label || key;
}

// 商品常见标签筛选项（与适配器 seed 标签一致）
export const GOODS_TAGS = ['官服', '渠道服', '可换绑', '包赔', '公示期'];

// 已确认的平台官方站点（外链直达用；商品详情页有 source_url 时优先用 source_url）
export const PLATFORM_LINKS = {
  jiaoyimao: 'https://www.jiaoyimao.com/',
  panzhi: 'https://www.pzds.com/',
  pangxie: 'https://www.pxb7.com/',
  7881: 'https://www.7881.com/',
  dd373: 'https://www.dd373.com/',
  5173: 'https://s.5173.com/',
};

export const CATEGORIES = ['手游', '端游'];

export function fmtPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return '¥' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtDateTime(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(ts) {
  return fmtDateTime(ts).slice(0, 10);
}
