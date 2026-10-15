/**
 * 浏览器采集器（采集智能体的执行器）：puppeteer-core + 本机 Edge headless
 *
 * 拟人化设计（避免被平台风控识别）：
 * - 全局复用 browser 实例（懒启动，断了自动重启），每次采集 openPage → close
 * - 每次页面随机 viewport（±5%）、随机鼠标轨迹、分段随机滚动（带偶尔回看）、随机停留
 * - 隐藏 navigator.webdriver 等自动化痕迹；浏览器内核让页面自带签名发请求
 * - 两种取数模式：拦 XHR JSON 响应 / page.evaluate 取渲染后 DOM
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

// 浏览器可执行文件：优先环境变量，其次按平台自动探测（Windows 用 Edge，Linux 用 Chrome/Chromium）
const CANDIDATES = process.platform === 'win32'
  ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
     'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
     '/usr/bin/chromium', '/usr/bin/chromium-browser',
     '/opt/google/chrome/chrome'];
const EDGE = process.env.BROWSER_EXECUTABLE_PATH && fs.existsSync(process.env.BROWSER_EXECUTABLE_PATH)
  ? process.env.BROWSER_EXECUTABLE_PATH
  : CANDIDATES.find(p => fs.existsSync(p));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 代理策略：采集目标全部是国内平台（交易猫/盼之/螃蟹/7881/DD373），
// 默认强制直连、忽略系统代理——本机开 Clash/V2Ray 等（系统代理出口为境外节点）时，
// 7881 等平台会直接 403（"您的请求有些频繁 ... guowai"，按境外 IP 封禁）。
// 如需走代理采集，显式设置环境变量 CRAWL_PROXY_SERVER（如 http://127.0.0.1:7890）。
const PROXY_ARGS = process.env.CRAWL_PROXY_SERVER
  ? [`--proxy-server=${process.env.CRAWL_PROXY_SERVER}`]
  : ['--no-proxy-server'];

const rand = (min, max) => min + Math.random() * (max - min);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser = null;

export async function ensureBrowser() {
  if (browser && browser.connected) return browser;
  if (browser) { try { await browser.close(); } catch {} browser = null; }
  if (!EDGE) {
    throw new Error('未找到浏览器，请安装 Chrome/Chromium 或设置环境变量 BROWSER_EXECUTABLE_PATH');
  }
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    protocolTimeout: 60_000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900', ...PROXY_ARGS],
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

export async function closeBrowser() {
  if (!browser) return;
  try { await browser.close(); } catch {}
  browser = null;
}

/**
 * 打开页面采集：goto → 等待 XHR → 可选滚动 → 可选 evaluate 取 DOM
 * @param {object} opts
 * @param {string} opts.url
 * @param {number} [opts.waitMs] 加载后等待时长（默认 8000ms，让 XHR 触发）
 * @param {RegExp} [opts.xhrFilter] 拦截匹配的 XHR URL
 * @param {boolean} [opts.scroll] 是否滚动触发更多 XHR（默认 false）
 * @param {boolean} [opts.mobile] 移动端 UA+视口（默认 false）
 * @param {Array} [opts.cookies] page.cookies() 格式的 cookie 数组，goto 前注入（带 WAF 验证 cookie 的平台用，如 DD373）
 * @param {function} [opts.evaluate] 等待结束后在页面执行，返回数据
 * @returns {Promise<{responses: Array<{url, body}>, evalResult: any, title: string, status: number}>}
 */
/**
 * 拟人浏览：随机鼠标轨迹 + 分段随机滚动（偶尔小幅回看），模拟真人阅读节奏。
 * 移动端无鼠标，只做分段滚动。
 */
async function humanBrowse(page, mobile, totalMs) {
  const start = Date.now();
  const vw = mobile ? 390 : 1400;
  const segments = 3 + Math.floor(Math.random() * 3); // 3~5 段
  let lastY = 0;
  for (let i = 0; i < segments; i++) {
    if (Date.now() - start >= totalMs - 800) break;
    // 桌面端：滚动前随机移动鼠标（分 4~8 步插值，轨迹更自然）
    if (!mobile && Math.random() < 0.7) {
      const x = rand(vw * 0.15, vw * 0.85);
      const y = rand(80, 700);
      await page.mouse.move(x, y, { steps: 4 + Math.floor(Math.random() * 5) }).catch(() => {});
    }
    // 30% 概率小幅上滚（回看），否则向下滚 0.3~0.9 个视口高度
    const backtrack = Math.random() < 0.3 && lastY > 300;
    const delta = backtrack ? -rand(80, 260) : rand(0.3, 0.9) * (mobile ? 700 : 820);
    lastY = Math.max(0, lastY + delta);
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), lastY).catch(() => {});
    // 段间随机停留 1.2~3.5s（模拟阅读）
    await sleep(rand(1200, 3500));
  }
  // 用完剩余等待时间（随机化，避免每轮节奏完全一致）
  const remain = totalMs - (Date.now() - start);
  if (remain > 0) await sleep(remain * rand(0.85, 1.1));
}

export async function openPage({ url, waitMs = 8000, xhrFilter, scroll = false, mobile = false, cookies, evaluate }) {
  const b = await ensureBrowser();
  const page = await b.newPage();
  // 注入平台验证 cookie（DD373 阿里云 ESA 滑块通过后的信任 cookie）
  if (Array.isArray(cookies) && cookies.length) {
    await page.setCookie(...cookies).catch(err => console.warn(`[collector] cookie 注入失败: ${err.message}`));
  }
  await page.setUserAgent(mobile ? MUA : UA);
  // 每次随机 viewport（基准 ±5%），模拟不同窗口尺寸
  if (mobile) {
    await page.setViewport({
      width: Math.round(rand(380, 402)), height: Math.round(rand(800, 868)),
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
  } else {
    await page.setViewport({
      width: Math.round(rand(1366, 1440)), height: Math.round(rand(820, 900)),
      deviceScaleFactor: 1,
    });
  }
  // 隐藏自动化痕迹 + 统一中文语言头
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }).catch(() => {});

  const responses = [];
  page.on('response', async (res) => {
    if (!xhrFilter || !xhrFilter.test(res.url())) return;
    try {
      const body = await res.text();
      responses.push({ url: res.url(), body, status: res.status() });
    } catch {}
  });

  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
  const status = resp ? resp.status() : 0;
  // 首屏随机停留（waitMs 的 20~35%），再进入拟人滚动/停留
  await sleep(waitMs * rand(0.2, 0.35));
  if (scroll) {
    await humanBrowse(page, mobile, waitMs * rand(0.65, 0.8));
  } else {
    // 不滚动的页面也随机停留 + 桌面端轻微鼠标移动，避免"打开即走"
    if (!mobile) await page.mouse.move(rand(200, 1100), rand(100, 600), { steps: 5 }).catch(() => {});
    await sleep(Math.max(500, waitMs * rand(0.5, 0.75)));
  }
  const title = await page.title().catch(() => '');
  const evalResult = evaluate ? await page.evaluate(evaluate).catch(() => null) : null;
  await page.close();
  return { responses, evalResult, title, status };
}

/**
 * 拟人移动页会话：打开 H5 首页预热（让设备指纹/无感验证 SDK 初始化、下发信任 cookie），
 * 在同一页面 JS 上下文内执行 fn(page) —— 适配器可用 page.evaluate(fetch) 直接调 H5 接口，
 * 自动携带页面 cookie 与指纹，最后统一关页。用于有 Aliyun FeiLin 防护、必须先预热的平台（螃蟹）。
 */
export async function withHumanMobilePage({ url = 'https://m1.pxb7.com/', warmMs } = {}, fn) {
  const b = await ensureBrowser();
  const page = await b.newPage();
  await page.setUserAgent(MUA);
  await page.setViewport({
    width: Math.round(rand(380, 402)), height: Math.round(rand(800, 868)),
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // 预热：触摸式分段滚动 + 随机停留（约 8~12s），帮助无感验证静默通过
  await humanBrowse(page, true, warmMs ?? rand(8000, 12000));
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 拟人 PC 页会话：打开 PC 站预热（滚动 + 随机停留建立会话 cookie），
 * 在同一页面 JS 上下文内执行 fn(page) —— 适配器可用 page.evaluate(fetch) 直接调同域接口，
 * 自动携带页面 cookie。用于列表接口需先有页面会话的平台（5173）。
 */
export async function withHumanPcPage({ url, warmMs } = {}, fn) {
  const b = await ensureBrowser();
  const page = await b.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({
    width: Math.round(rand(1366, 1440)), height: Math.round(rand(820, 900)),
    deviceScaleFactor: 1,
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  // 预热：分段滚动 + 随机停留（约 6~10s），让会话 cookie 下发
  await humanBrowse(page, false, warmMs ?? rand(6000, 10000));
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/** 从 responses 里找第一个能 JSON.parse 且匹配形状的，返回 parsed + 原始 url */
export function pickJsonResponse(responses, shapeTest) {
  for (const r of responses) {
    try {
      const d = JSON.parse(r.body);
      if (shapeTest(d)) return { data: d, url: r.url };
    } catch {}
  }
  return null;
}
