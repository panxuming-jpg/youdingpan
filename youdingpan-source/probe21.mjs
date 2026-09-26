// 第二十一轮：解析pzds NUXT + pxb7正确URL + 交易猫重试
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

// 1. 解析 nuxt_pzds.json
{
  const nu = JSON.parse(fs.readFileSync('nuxt_pzds.json', 'utf8'));
  const goodsArrs = [];
  const find = (o, path, depth) => {
    if (depth > 6 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      if (o.length >= 5 && o[0] && typeof o[0] === 'object' && !Array.isArray(o[0])) {
        const keys = Object.keys(o[0]).join(',');
        if (/price|goods/i.test(keys)) goodsArrs.push({ path, len: o.length, keys: keys.slice(0, 500) });
      }
      o.forEach((x, i) => { if (i < 3) find(x, path + '[]', depth + 1); });
      return;
    }
    for (const k of Object.keys(o).slice(0, 40)) find(o[k], path + '.' + k, depth + 1);
  };
  find(nu, 'root', 0);
  for (const g of goodsArrs) console.log(`[pzds] 数组 ${g.path} len=${g.len}\n  字段: ${g.keys}\n`);
}

// 2/3. 浏览器
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

async function watch(name, url, waitMs, xhrFilter, scroll = false) {
  console.log(`\n===== ${name} ${url}`);
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1400, height: 900 });
  const seen = new Map();
  page.on('response', async (res) => {
    const u = res.url();
    if (!xhrFilter.test(u)) return;
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await res.text();
      seen.set(u, { len: body.length, head: body.replace(/\s+/g, ' ').slice(0, 400) });
    } catch {}
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('goto:', e.message));
  await new Promise(r => setTimeout(r, 6000));
  if (scroll) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
  }
  await new Promise(r => setTimeout(r, waitMs));
  console.log('title:', await page.title().catch(() => '-'));
  const pc = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+/g)?.length || 0).catch(() => 0);
  console.log('价格串数:', pc);
  for (const [u, v] of seen) console.log(`  XHR ${v.len}B ${u.slice(0, 130)}\n    ${v.head.slice(0, 300)}`);
  await page.close();
}

try {
  // 螃蟹：参数形式尝试
  await watch('pxb7-sw', 'https://www.pxb7.com/buy/searchResult?searchWord=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80&gameId=10013&bizProd=1', 8000, /api-pc\.pxb7\.com/, true);
  // 交易猫：长等待+滚动
  await watch('jym', 'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', 10000, /jiaoyimao\.com/, true);
} finally {
  await browser.close();
}
