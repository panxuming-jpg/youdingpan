/**
 * DD373 滑块验证工具（一次性人工操作，cookie 复用）
 *
 * 背景：DD373 用阿里云 ESA 滑块验证拦 headless 采集。本脚本弹出有头浏览器窗口，
 * 人工拖动一次滑块通过验证后，自动把信任 cookie 落盘到 server/data/dd373_cookies.json，
 * 之后采集适配器（server/src/engine/adapters/dd373.js）每次打开页面自动注入该 cookie，
 * 无需再过滑块（cookie 失效后重跑本脚本即可）。
 *
 * 用法: node dd373_login.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 浏览器探测（与 server/src/engine/collector.js 同规则）
const CANDIDATES = process.platform === 'win32'
  ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
     'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
     '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'];
const EDGE = process.env.BROWSER_EXECUTABLE_PATH && fs.existsSync(process.env.BROWSER_EXECUTABLE_PATH)
  ? process.env.BROWSER_EXECUTABLE_PATH
  : CANDIDATES.find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到浏览器，请设置环境变量 BROWSER_EXECUTABLE_PATH'); process.exit(1); }

// 验证通过判定用的列表页（王者荣耀，按发布时间排序）
const CHECK_URL = 'https://www.dd373.com/s-33vu84-0-0-0-0-0-0-0-0-0-0-0-1-0-2-0.html';
const OUT_FILE = path.join(__dirname, 'server', 'data', 'dd373_cookies.json');

// 默认忽略系统代理直连（国内站点），可用 CRAWL_PROXY_SERVER 覆盖
const proxyArg = process.env.CRAWL_PROXY_SERVER
  ? `--proxy-server=${process.env.CRAWL_PROXY_SERVER}`
  : '--no-proxy-server';

console.log('正在打开浏览器窗口（有头模式）...');
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900', proxyArg],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

console.log('==> 如果页面出现滑块验证，请在浏览器窗口中手动拖动滑块完成验证');
console.log('==> 验证通过（出现商品列表）后将自动保存 cookie 并关闭窗口，最长等待 10 分钟');
// 提示音提醒用户窗口已弹出（Windows 蜂鸣）
process.stdout.write('\x07');

const deadline = Date.now() + 600_000;
let ok = false;
let tick = 0;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 3000));
  const st = await page.evaluate(() => ({
    title: document.title || '',
    items: document.querySelectorAll('div.goods-list-item.zh-goods-item').length,
  })).catch(() => null);
  if (st && st.items > 0 && !/验证/.test(st.title)) { ok = true; break; }
  tick++;
  if (st && tick % 5 === 0) console.log(`  等待人工验证...（title=${(st.title || '(空)').slice(0, 24)} 商品=${st.items}，剩余 ${Math.round((deadline - Date.now()) / 1000)}s）`);
}

if (!ok) {
  console.error('超时未检测到验证通过，未保存任何 cookie');
  await browser.close();
  process.exit(1);
}

// 滑块通过后重新加载列表页，确认信任 cookie 已生效（应直接出商品、不再出滑块）
console.log('检测到商品列表，正在重新加载页面确认 cookie 生效...');
await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await new Promise(r => setTimeout(r, 5000));
const confirm = await page.evaluate(() => ({
  title: document.title || '',
  items: document.querySelectorAll('div.goods-list-item.zh-goods-item').length,
})).catch(() => null);
if (!confirm || !confirm.items || /验证/.test(confirm.title || '')) {
  console.error(`重新加载后仍未出商品（title=${confirm?.title} 商品=${confirm?.items}），cookie 可能未生效，请重试`);
  await browser.close();
  process.exit(1);
}
console.log(`确认通过：title=${confirm.title}，商品 ${confirm.items} 条`);

// 只保存 dd373 域的 cookie（含 ESA 信任 cookie），采集时整组注入
const cookies = await page.cookies('https://www.dd373.com');
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(cookies, null, 2));
console.log(`验证通过！已保存 ${cookies.length} 条 cookie → ${OUT_FILE}`);
console.log(`cookie 名称: ${cookies.map(c => c.name).join(', ')}`);
await browser.close();
process.exit(0);
