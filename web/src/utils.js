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

// 平台图标：按平台 key 映射，圆形 logo 风格小图标
const PLATFORM_PROMPTS = {
  jiaoyimao: 'cute orange cat mascot logo icon for a game trading platform, flat design, orange and white, round app icon, minimal vector style',
  panzhi: 'red shield logo icon with letter P for a game account consignment platform, flat design, red and white, round app icon, minimal vector style',
  pangxie: 'cute red crab mascot logo icon for a game account trading platform, flat design, red and white, round app icon, minimal vector style',
  7881: 'blue number 7881 logo icon for a game trading platform, flat design, blue and white, round app icon, minimal vector style',
  dd373: 'green letters DD logo icon for a game trading platform, flat design, green and white, round app icon, minimal vector style',
  5173: 'red number 5173 logo icon for a game trading platform, flat design, red and white, round app icon, minimal vector style',
};

export function platformIcon(key) {
  const prompt = PLATFORM_PROMPTS[key];
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

// ---------- 追账号维权（PRD 模块 F）：状态中文映射与颜色徽章，统一常量表 ----------
export const RIGHTS_STATUS = {
  pending_verify: { label: '待平台核验', badge: 'badge-warning', hint: '平台正在核验交易存证与自证材料，一般 72 小时内出结果' },
  filed: { label: '核验成立·已立案', badge: 'badge-primary', hint: '证据核验成立，卖家等额资金已冻结，可生成起诉/报案文书' },
  rejected: { label: '核验未通过', badge: 'badge-danger', hint: '证据核验未通过，可补充证据后重新发起维权' },
  docs_ready: { label: '文书已生成', badge: 'badge-primary', hint: '文书已生成，请打印签署后递交法院/派出所并回填进度' },
  submitted: { label: '已递交', badge: 'badge-warning', hint: '已递交司法机关，办理进展请及时回填' },
  in_progress: { label: '办理中', badge: 'badge-primary', hint: '司法程序办理中，结案后请回填结果以便解除卖家冻结' },
  closed_done: { label: '已结案', badge: 'badge-success', hint: '维权案已结案，卖家冻结资金已按规则处理' },
  closed: { label: '已关闭', badge: 'badge', hint: '维权案已关闭（撤销或流程终止）' },
};

export function rightsStatus(s) {
  return RIGHTS_STATUS[s] || { label: s || '-', badge: 'badge', hint: '' };
}

export const RIGHTS_CLAIM_TYPES = [
  { key: 'civil', label: '民事起诉' },
  { key: 'criminal', label: '刑事报案' },
  { key: 'compensation', label: '先走包赔' },
];

export function claimTypeLabel(k) {
  return RIGHTS_CLAIM_TYPES.find(c => c.key === k)?.label || k;
}

export const RIGHTS_SCENARIOS = ['实名信息被改', '绑定手机/邮箱被换', '原卖家通过客服申诉找回', '密码被改', '其他'];

export const RIGHTS_RESULTS = ['获赔', '胜诉', '和解', '败诉', '不予立案'];

export const RIGHTS_EVENT_ACTOR = { buyer: '买家', seller: '卖家', admin: '运营', system: '系统' };

export const RIGHTS_EVENT_TYPE = {
  created: '提交申请', verified: '核验成立', rejected: '核验驳回', evidence: '补充证据',
  doc_generated: '生成文书', progress: '进度回填', cancelled: '撤销维权',
  cert_request: '申请存证证明', cert_issued: '签发存证证明', unfrozen: '解除冻结',
};

export const RIGHTS_DOC_KIND = { complaint: '民事起诉状', report_pack: '报案材料包', cert: '交易存证证明' };

/** 在新窗口渲染文书 HTML（附打印按钮）；弹窗被拦截时返回 false */
export function openDocWindow(html) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html +
    '<div style="position:fixed;bottom:18px;right:18px;z-index:9">' +
    '<button onclick="window.print()" style="padding:10px 22px;border:none;border-radius:8px;' +
    'background:#ff6a00;color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(255,106,0,.4)">' +
    '打印 / 另存为 PDF</button></div>');
  w.document.close();
  return true;
}
