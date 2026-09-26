// 探测交易猫 PC search 页 XHR：等加载 + 滚动，看是否触发商品列表接口
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

const url = 'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80';
console.log('打开:', url);
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setViewport({ width: 1400, height: 900 });

const xhrHits = [];
page.on('response', async (res) => {
  const u = res.url();
  if (!/jiaoyimao\.com|alicdn|gw\.|api\.|mtop/i.test(u)) return;
  try {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json') && !ct.includes('text')) return;
    const body = await res.text();
    // 只看含商品/价格/load/list 关键字的响应
    if (body.length > 500 && /price|goods|product|list|search|result/i.test(body)) {
      xhrHits.push({ url: u.slice(0, 180), len: body.length, head: body.replace(/\s+/g, ' ').slice(0, 300), status: res.status() });
    }
  } catch {}
});

const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => { console.log('goto:', e.message); return null; });
console.log('status:', resp && resp.status());
await new Promise(r => setTimeout(r, 5000));
console.log('title:', await page.title().catch(() => '-'));
const finalUrl = page.url();
console.log('最终 URL:', finalUrl);

// 滚动+长等待
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
await new Promise(r => setTimeout(r, 5000));

const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(?:\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
console.log('价格串数:', priceCount);

console.log('\n=== 商品相关 XHR ===');
for (const h of xhrHits) {
  console.log(`  [${h.status}] ${h.len}B ${h.url}`);
  console.log(`    ${h.head.slice(0, 250)}`);
}
if (!xhrHits.length) console.log('  (未拦到商品 XHR)');

// dump DOM 商品卡片候选
const probe = await page.evaluate(() => {
  const result = {};
  const candidates = [
    '.goods-list li', '.search-result-list li', '.goods-item', '.goodsList li',
    '.list-item', '.product-list li', '.gl-item', '.J_ItemList li',
    '.goods-card', '.card-goods', '[data-spm]', '.search-list-item',
    '.saleList--hotSaleList li', '.search-result-item', '.jym-goods-item',
    '.game-list li', '.goodsListBox li', '.search_list li',
  ];
  for (const sel of candidates) {
    try {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) result[sel] = els.length;
    } catch {}
  }
  return result;
}).catch(() => ({}));
console.log('\nDOM 选择器命中:', JSON.stringify(probe));

await browser.close();
