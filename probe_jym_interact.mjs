// 探测交易猫搜索页：模拟交互触发商品 XHR
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

const url = 'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80';
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setViewport({ width: 1400, height: 900 });

const xhrHits = [];
page.on('response', async (res) => {
  const u = res.url();
  try {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const body = await res.text();
    if (body.length > 200 && /price|goods|product|list|result/i.test(body)) {
      xhrHits.push({ url: u.slice(0, 200), len: body.length, head: body.replace(/\s+/g, ' ').slice(0, 500), status: res.status() });
    }
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await new Promise(r => setTimeout(r, 4000));
console.log('初始页面 title:', await page.title().catch(() => '-'));

// 尝试 1：找 input 触发搜索
const inputInfo = await page.evaluate(() => {
  const inputs = document.querySelectorAll('input');
  return [...inputs].slice(0, 5).map(i => ({ name: i.name, type: i.type, cls: i.className, placeholder: i.placeholder }));
}).catch(() => []);
console.log('inputs:', JSON.stringify(inputInfo));

// 在 input 里输入并回车
try {
  const input = await page.$('input[name="game-search"], input.search-input, input[type="text"]').catch(() => null);
  if (input) {
    await input.click({ clickCount: 3 });
    await input.type('王者荣耀', { delay: 50 });
    await new Promise(r => setTimeout(r, 1500));
    await page.keyboard.press('Enter');
    console.log('已输入并回车');
  } else {
    console.log('未找到 input');
  }
} catch (e) {
  console.log('输入失败:', e.message);
}

await new Promise(r => setTimeout(r, 6000));
const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(?:\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
console.log('价格串数:', priceCount);
console.log('最终 URL:', page.url());

console.log('\n=== 商品 XHR ===');
for (const h of xhrHits) {
  console.log(`  [${h.status}] ${h.len}B ${h.url}`);
  console.log(`    ${h.head.slice(0, 350)}`);
}

await browser.close();
