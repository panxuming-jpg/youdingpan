// 第十四轮：螃蟹API参数 / 7881商品模板 / 交易猫search模块
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function req(name, url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.pxb7.com', 'Referer': 'https://www.pxb7.com/', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    console.log(`[${name}] ${res.status} len=${t.length}:`, t.replace(/\s+/g, ' ').slice(0, 350));
    return t;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message}`);
    return null;
  }
}

// 1. pxb7 首页 4KB 全文找运行时配置
const ph = fs.readFileSync('pxb7_home.html', 'utf8');
const tail = ph.slice(2500);
console.log('[pxb7-home] 尾部:', tail.replace(/\s+/g, ' ').slice(0, 1200));

// 2. pxb7 API 参数摸索
await req('pxb7-game-p', 'https://www.pxb7.com/api/product/web/game?pageNum=1&pageSize=10');
await req('pxb7-game-post', 'https://www.pxb7.com/api/product/web/game', { method: 'POST', body: { pageNum: 1, pageSize: 10 } });
await req('pxb7-search-kw', 'https://www.pxb7.com/api/search?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80&pageNum=1&pageSize=10');
await req('pxb7-gwgame', 'https://www.pxb7.com/api/gateway-open/product/web/game/homeSpecialZone/gameList', { method: 'POST', body: { pageNum: 1, pageSize: 10 } });

// 3. 7881：listTemplate 与 colGoodsArr 值 + ajax 线索
const w = fs.readFileSync('a7881_wzry.html', 'utf8');
let i = w.indexOf('var listTemplate');
if (i < 0) i = w.indexOf('listTemplate');
console.log('[7881] listTemplate ctx:', w.slice(i, i + 800).replace(/\s+/g, ' ').slice(0, 700));
i = w.indexOf('var colGoodsArr');
if (i >= 0) console.log('[7881] colGoodsArr:', w.slice(i, i + 300).replace(/\s+/g, ' ').slice(0, 280));
const actions = [...new Set([...w.matchAll(/["']([^"']*(?:\.action|\.do|ajax|\.json|loadGoods|searchGoods|getGoods)[^"']*)["']/g)].map(m => m[1]))];
console.log('[7881] 列表页 action 线索:', actions.slice(0, 20));

// 4. 交易猫：search 模块 JS
async function jget(name, url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.jiaoyimao.com/' }, signal: AbortSignal.timeout(30000) });
    const t = await res.text();
    console.log(`[${name}] ${res.status} len=${t.length}`);
    return t;
  } catch (e) { console.log(`[${name}] ERROR: ${e.message}`); return null; }
}
const jsVer = '2026092314';
for (const u of [
  `https://image.jiaoyimao.com/public/pc/js/dev/app/search.js?${jsVer}`,
  `https://image.jiaoyimao.com/public/pc/js/dev/app/search/main.js?${jsVer}`,
]) {
  const js = await jget('jym-mod', u);
  if (js && js.length > 200) {
    const xhrs = [...new Set([...js.matchAll(/["']([^"']*(?:\/[a-z-]+){1,4}(?:\.json|\.action|search|goods)[^"']{0,50})["']/g)].map(m => m[1]).filter(p => /\//.test(p)))];
    console.log('[jym-mod] XHR 线索:', xhrs.slice(0, 25));
    const urls = [...new Set([...js.matchAll(/["'](https?:\/\/[^"']{5,90})["']/g)].map(m => m[1]).filter(p => !/\.(png|jpg|gif|css)/i.test(p)))];
    console.log('[jym-mod] URLs:', urls.slice(0, 15));
    break;
  }
}
