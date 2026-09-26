// 试不同 URL 模式找交易猫真实游戏商品页
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

const urls = [
  'https://www.jiaoyimao.com/g2416',                  // 无 -c1
  'https://www.jiaoyimao.com/game/g2416/',            // /game/{id}/
  'https://www.jiaoyimao.com/g/2416/',                 // /g/{id}/
  'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80',  // 搜索页
  'https://www.jiaoyimao.com/p2416',                   // /p{id}
  'https://www.jiaoyimao.com/g2416-c1',                // 无尾斜杠
  'https://so.jiaoyimao.com/game/g2416/',              // so 子域
];

for (const url of urls) {
  console.log(`\n=== ${url} ===`);
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1400, height: 900 });
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => { console.log('goto err:', e.message); return null; });
  console.log('status:', resp && resp.status(), 'finalUrl:', page.url().slice(0, 100));
  const title = await page.title().catch(() => '-');
  console.log('title:', title.slice(0, 80));
  await new Promise(r => setTimeout(r, 3000));
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '');
  const isPunish = bodyText.includes('punish') || bodyText.includes('_____tmd_____');
  console.log('被 punish:', isPunish);
  if (!isPunish) {
    const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(?:\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
    console.log('价格串数:', priceCount, 'body预览:', bodyText.slice(0, 100).replace(/\n/g, ' '));
  }
  await page.close();
}

await browser.close();
