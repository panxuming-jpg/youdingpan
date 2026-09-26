// 第二十轮：7881完整字段 + 盼之SSR数据 + 螃蟹/交易猫试验
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1400, height: 900 });
  return page;
}

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

try {
  // 1. 7881：完整商品字段
  {
    const page = await newPage(browser);
    let firstItem = null;
    page.on('response', async (res) => {
      if (res.url().includes('goods/list') && !firstItem) {
        try {
          const d = JSON.parse(await res.text());
          firstItem = d?.body?.results?.[0] || null;
        } catch {}
      }
    });
    await page.goto('https://search.7881.com/A2705-100001-0-0-0.html?pageNum=1', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 8000));
    if (firstItem) {
      fs.writeFileSync('item_7881.json', JSON.stringify(firstItem, null, 2));
      console.log('[7881] 商品字段:', Object.keys(firstItem).join(','));
      console.log('[7881] 样例:', JSON.stringify(firstItem).slice(0, 600));
    } else console.log('[7881] 未捕获');
    await page.close();
  }

  // 2. 盼之：__NUXT__ SSR 数据
  {
    const page = await newPage(browser);
    await page.goto('https://www.pzds.com/goodsList/7/6', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 8000));
    const nu = await page.evaluate(() => {
      try {
        const s = window.__NUXT__ || (window.__NUXT__ = undefined);
        return JSON.stringify(s);
      } catch (e) { return 'ERR:' + e.message; }
    });
    if (nu && !nu.startsWith('ERR')) {
      fs.writeFileSync('nuxt_pzds.json', nu);
      console.log('[pzds] __NUXT__ 长度:', nu.length);
      // 找商品数组
      try {
        const d = JSON.parse(nu);
        const find = (o, path, depth) => {
          if (depth > 5 || !o || typeof o !== 'object') return null;
          if (Array.isArray(o)) {
            if (o.length > 5 && typeof o[0] === 'object' && o[0] && ('price' in o[0] || 'goodsId' in JSON.stringify(Object.keys(o[0])).toLowerCase() || JSON.stringify(Object.keys(o[0])).match(/price|goods/i))) {
              console.log(`[pzds] 商品数组 at ${path} len=${o.length}`);
              console.log('[pzds] 字段:', Object.keys(o[0]).join(','));
              console.log('[pzds] 样例:', JSON.stringify(o[0]).slice(0, 700));
              return o[0];
            }
            for (const x of o) { const f = find(x, path + '[]', depth + 1); if (f) return f; }
            return null;
          }
          for (const k of Object.keys(o)) { const f = find(o[k], path + '.' + k, depth + 1); if (f) return f; }
          return null;
        };
        find(d, 'root', 0);
      } catch (e) { console.log('[pzds] parse err', e.message); }
    } else console.log('[pzds] __NUXT__:', String(nu).slice(0, 100));
    await page.close();
  }

  // 3. 螃蟹：搜索结果页
  {
    const page = await newPage(browser);
    let captured = [];
    page.on('response', async (res) => {
      const u = res.url();
      if (u.includes('productPage') || u.includes('search')) {
        try {
          const ct = res.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const body = await res.text();
            captured.push({ u: u.slice(0, 150), len: body.length, head: body.slice(0, 200) });
          }
        } catch {}
      }
    });
    await page.goto('https://www.pxb7.com/buy/searchResult?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('[pxb7] goto:', e.message));
    await new Promise(r => setTimeout(r, 10000));
    console.log('[pxb7] title:', await page.title().catch(() => '-'));
    const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+/g)?.length || 0).catch(() => 0);
    console.log('[pxb7] 价格串数:', priceCount);
    for (const c of captured) console.log(`[pxb7] XHR ${c.u} len=${c.len} head=${c.head.replace(/\s+/g, ' ').slice(0, 150)}`);
    await page.close();
  }

  // 4. 交易猫：search 页
  {
    const page = await newPage(browser);
    let jymJson = [];
    page.on('response', async (res) => {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json') && res.url().includes('jiaoyimao')) {
        try {
          const body = await res.text();
          if (body.length > 2000) jymJson.push({ u: res.url().slice(0, 140), len: body.length });
        } catch {}
      }
    });
    await page.goto('https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('[jym] goto:', e.message));
    await new Promise(r => setTimeout(r, 12000));
    console.log('[jym] title:', await page.title().catch(() => '-'));
    const pc = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+/g)?.length || 0).catch(() => 0);
    console.log('[jym] 价格串数:', pc);
    for (const c of jymJson) console.log(`[jym] XHR ${c.u} len=${c.len}`);
    await page.close();
  }
} finally {
  await browser.close();
}
