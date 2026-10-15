// 与后端 db.js 中 PLATFORMS 保持一致的真实平台
export const PLATFORMS = [
  { key: 'jiaoyimao', name: '交易猫' },
  { key: 'panzhi', name: '盼之代售' },
  { key: 'pangxie', name: '螃蟹账号' },
  { key: '7881', name: '7881' },
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
};

export const CATEGORIES = ['手游', '端游'];

// 游戏主图（图标）：按游戏名映射，业界交易网站风格的游戏封面方图
const GAME_ICON_URL = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image';
const GAME_PROMPTS = {
  '王者荣耀': 'Honor of Kings mobile MOBA game app icon, heroic fantasy Chinese warrior portrait, golden armor, blue and gold color scheme, glossy rounded square game icon, official splash art style, high detail',
  '和平精英': 'Game for Peace battle royale mobile game app icon, soldier wearing spetsnaz helmet, military shooter style, orange and dark tones, rounded square game icon, official art',
  '无畏契约': 'Valorant tactical FPS game app icon, stylized agent character portrait, red black and white angular graphic design, rounded square game icon, official art style',
  '三角洲行动': 'Delta Force tactical military shooter game app icon, special forces operator with night vision goggles, dark green and black, rounded square game icon, official art',
  '原神': 'Genshin Impact game app icon, cute anime fairy character with white hair floating, cel shaded anime style, bright blue sky background, rounded square game icon, official art',
  '崩坏：星穹铁道': 'Honkai Star Rail game app icon, anime girl with pink hair, space fantasy style, stars and train, rounded square game icon, official art',
  '三国杀': 'Legends of the Three Kingdoms card game app icon, ancient Chinese general portrait with long beard and armor, ink painting style, red and gold, rounded square game icon',
  '火影忍者': 'Naruto mobile fighting game app icon, anime ninja with spiky blond hair and forehead protector, orange jacket, dynamic pose, rounded square game icon, official art',
  '鸣潮': 'Wuthering Waves game app icon, anime character with silver hair, sci-fi fantasy style, blue tones, rounded square game icon, official art',
  '穿越火线（CF）': 'CrossFire FPS game app icon, soldier holding assault rifle, military shooter style, dark background with orange glow, rounded square game icon',
  '暗区突围': 'Arena Breakout tactical FPS game app icon, soldier in full tactical gear with helmet and visor, dark realistic military extraction shooter style, rounded square game icon',
  '永劫无间': 'Naraka Bladepoint game app icon, masked wuxia warrior woman, red and white colors, Chinese martial arts style, rounded square game icon, official art',
  '梦幻西游': 'Fantasy Westward Journey game app icon, cute chibi Chinese fantasy character, colorful cartoon style, rounded square game icon',
  '逆水寒': 'Justice Online game app icon, ancient Chinese swordsman portrait, wuxia ink painting style, elegant, rounded square game icon',
  '地下城与勇士': 'Dungeon Fighter Online game app icon, anime fighter character, action dungeon crawler style, rounded square game icon',
  '英雄联盟': 'League of Legends game app icon, fantasy MOBA champion portrait, blue and gold, rounded square game icon, official art',
  '剑网3': 'JX Online 3 game app icon, ancient Chinese wuxia swordsman in white robe, ink painting style, rounded square game icon',
};

export function gameCover(name) {
  const prompt = GAME_PROMPTS[name];
  if (!prompt) return '';
  return `${GAME_ICON_URL}?prompt=${encodeURIComponent(prompt)}&image_size=square`;
}

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
