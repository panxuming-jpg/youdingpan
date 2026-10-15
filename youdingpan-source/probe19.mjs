// 浏览器采集试验：headless Edge 打开列表页，拦截商品 XHR
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const TARGETS = [
  { name: 'pzds-wzry', url: 'https://www.pzds.com/goodsList/7/6', wait: 9000 },
  { name: '7881-wzry', url: 'https://search.7881.com/A2705-100001-0-0-0.html?pageNum=1', wait: 9000 },
];

async function watch(name, url, waitMs) {
  console.log(`\n===== ${name} ${url}`);
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1400, height: 900 });
    const hits = [];
    page.on('response', async (res) => {
      const u = res.url();
      try {
        const ct = (res.headers()['content-type'] || '');
        if (!ct.includes('json')) return;
        const body = await res.text();
        if (body.length > 3000 && /"(goods|list|product|items|rows|records)/i.test(body.slice(0, 2000))) {
          hits.push({ url: u.slice(0, 160), status: res.status(), len: body.length, body });
        }
      } catch {}
    });
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => { console.log('goto err:', e.message); return null; });
    console.log('goto status:', resp && resp.status());
    await new Promise(r => setTimeout(r, waitMs));
    const title = await page.title().catch(() => '-');
    console.log('title:', title);
    // 页面上可见的价格数量（判断是否渲染出商品）
    const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
    console.log('页面价格串数量:', priceCount);
    for (const h of hits) {
      console.log(`\n-- XHR ${h.status} len=${h.len} ${h.url}`);
      try {
        const d = JSON.parse(h.body);
        console.log('   顶层键:', Object.keys(d).join(','));
        console.log('   内容预览:', h.body.replace(/\s+/g, ' ').slice(0, 500));
      } catch {}
    }
    if (!hits.length) console.log('(未捕获到疑似商品 JSON)');
  } finally {
    await browser.close();
  }
}

for (const t of TARGETS) await watch(t.name, t.url, t.wait);
