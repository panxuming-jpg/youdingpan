// 第二十二轮：螃蟹 /buy/10013/1 + 交易猫游戏页/移动端
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

async function watch(name, url, waitMs, filter, mobile = false) {
  console.log(`\n===== ${name} ${url}`);
  const page = await browser.newPage();
  await page.setUserAgent(mobile ? MUA : UA);
  if (mobile) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1400, height: 900 });
  const seen = new Map();
  page.on('response', async (res) => {
    if (!filter.test(res.url())) return;
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await res.text();
      seen.set(res.url(), { len: body.length, head: body.replace(/\s+/g, ' ').slice(0, 400) });
    } catch {}
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('goto:', e.message));
  await new Promise(r => setTimeout(r, waitMs));
  console.log('title:', await page.title().catch(() => '-'));
  const pc = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+/g)?.length || 0).catch(() => 0);
  console.log('价格串数:', pc);
  for (const [u, v] of seen) console.log(`  XHR ${v.len}B ${u.slice(0, 130)}\n    ${v.head.slice(0, 260)}`);
  await page.close();
}

try {
  await watch('pxb7-buy', 'https://www.pxb7.com/buy/10013/1', 10000, /api-pc\.pxb7\.com/);
  await watch('jym-game', 'https://www.jiaoyimao.com/g2416-c1/', 10000, /jiaoyimao\.com|mtop/);
  await watch('jym-m', 'https://m.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', 12000, /jiaoyimao\.com|mtop/, true);
} finally {
  await browser.close();
}
