// 探测螃蟹 /buy/10013/1 商品 XHR：滚动 + 长等待触发 productPage
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

const url = 'https://www.pxb7.com/buy/10013/1';
console.log('打开:', url);
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setViewport({ width: 1400, height: 900 });

const xhrHits = [];
page.on('response', async (res) => {
  const u = res.url();
  if (!/api-pc\.pxb7\.com|openapi\.pxb7\.com/.test(u)) return;
  try {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const body = await res.text();
    xhrHits.push({ url: u.slice(0, 200), len: body.length, head: body.replace(/\s+/g, ' ').slice(0, 300), status: res.status() });
  } catch {}
});

await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('goto:', e.message));
await new Promise(r => setTimeout(r, 5000));
console.log('title:', await page.title().catch(() => '-'));
const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(?:\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
console.log('首屏价格串:', priceCount);

// 滚动 3 次
for (let i = 1; i <= 3; i++) {
  await page.evaluate((n) => window.scrollTo(0, document.body.scrollHeight * n / 4), i).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
}
const pc2 = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(?:\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
console.log('滚动后价格串:', pc2);

console.log('\n=== 螃蟹 XHR ===');
for (const h of xhrHits) {
  console.log(`  [${h.status}] ${h.len}B ${h.url}`);
  console.log(`    ${h.head.slice(0, 250)}`);
}

// DOM 取商品卡片候选
const probe = await page.evaluate(() => {
  const result = {};
  const candidates = [
    '.goods-list li', '.goods-item', '.goodsList li', '.list-item',
    '.product-item', '.goods-card', '.card-goods', '.account-item',
    '.buy-list li', '.goods_list li', '.goods-cell', '.goods-list-item',
    '[data-goods-id]', '.saleList li', '.product-list li', '.productPage li',
    '.pc-goods-list li', '.list-wrap li',
  ];
  for (const sel of candidates) {
    try { const els = document.querySelectorAll(sel); if (els.length) result[sel] = els.length; } catch {}
  }
  // 价格元素反推
  const priceEls = [...document.querySelectorAll('*')].filter(el => {
    const t = (el.textContent || '').trim();
    return t.length < 30 && /^[\s¥￥]*(\d{2,6}(?:\.\d{1,2})?)\s*元?$/.test(t);
  });
  result['__priceElCount'] = priceEls.length;
  if (priceEls.length) {
    const classes = new Set();
    for (const p of priceEls.slice(0, 10)) {
      let cur = p;
      for (let i = 0; i < 5 && cur; i++) {
        const cls = cur.className && typeof cur.className === 'string' ? cur.className : '';
        if (cls) classes.add(cls.split(' ')[0]);
        cur = cur.parentElement;
      }
    }
    result['__priceClasses'] = [...classes].slice(0, 10);
  }
  return result;
}).catch(() => ({}));
console.log('\nDOM 命中:', JSON.stringify(probe, null, 2));

// dump 商品卡片样本
const sample = await page.evaluate(() => {
  const priceEls = [...document.querySelectorAll('*')].filter(el => {
    const t = (el.textContent || '').trim();
    return t.length < 30 && /^[\s¥￥]*(\d{2,6}(?:\.\d{1,2})?)\s*元?$/.test(t);
  });
  if (!priceEls.length) return null;
  let card = priceEls[0];
  for (let i = 0; i < 5; i++) if (card.parentElement) card = card.parentElement;
  return card.outerHTML.slice(0, 1500);
}).catch(() => null);
console.log('\n卡片样本:\n', sample);

await browser.close();
