// 重新探测螃蟹 pxb7.com：触发 productPage XHR 的方式（滚动/点击 tab/直接观察请求）
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setViewport({ width: 1400, height: 1600 });

// 王者荣耀 gameId=10013 bizProd=1
const url = 'https://www.pxb7.com/buy/10013/1';
console.log('打开:', url);
const all = [];
page.on('response', async (res) => {
  const u = res.url();
  const ct = res.headers()['content-type'] || '';
  if (!ct.includes('json') || /static|\.css|\.js\?/i.test(u)) return;
  try {
    const body = await res.text();
    all.push({ u: u.slice(0, 180), s: res.status(), body: body.slice(0, 200) });
  } catch {}
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('goto fail', e.message));
await new Promise(r => setTimeout(r, 5000));

// 尝试滚动触发
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => window.scrollBy(0, 700)).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
}

// 尝试点击商品列表区域的 tab/排序按钮
const clickCandidates = await page.evaluate(() => {
  const sel = ['.tab', '.sort', '[class*=tab]', '[class*=sort]', 'ul.nav li', '.goods-nav li'];
  const out = [];
  for (const s of sel) {
    document.querySelectorAll(s).forEach((el, i) => {
      if (i < 6) out.push({ sel: s, text: el.innerText.trim().slice(0, 30), cls: el.className });
    });
  }
  return out;
}).catch(() => []);
console.log('\n可点击候选:', JSON.stringify(clickCandidates));

// 试着点击第一个 tab
if (clickCandidates.length) {
  try {
    await page.click(clickCandidates[0].sel).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
  } catch {}
}

await new Promise(r => setTimeout(r, 4000));

console.log(`\nJSON XHR 共 ${all.length} 条:`);
for (const a of all) console.log(`\n[${a.s}] ${a.u}\n  ${a.body.replace(/\s+/g, ' ').slice(0, 180)}`);

// DOM 商品探测
const dom = await page.evaluate(() => {
  const sels = ['.goods-list .item', '.product-list li', '[class*=product] li', '[class*=goods] li', '.list-item'];
  const found = {};
  for (const s of sels) found[s] = document.querySelectorAll(s).length;
  const prices = [...document.querySelectorAll('[class*=price]')].slice(0, 5).map(e => e.innerText.trim().slice(0, 25));
  return { found, prices, title: document.title };
}).catch(() => ({}));
console.log('\nDOM:', JSON.stringify(dom, null, 1));

await browser.close();
process.exit(0);
