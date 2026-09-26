// 第十五轮：直击 api-pc.pxb7.com
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const fs = await import('node:fs');

// 完整运行时配置
const ph = fs.readFileSync('pxb7_home.html', 'utf8');
const ci = ph.indexOf('window.__NUXT__.config=');
console.log('[pxb7] 完整 config:', ph.slice(ci, ci + 900).replace(/\s+/g, ' '));

async function req(name, url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.pxb7.com', 'Referer': 'https://www.pxb7.com/', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    console.log(`[${name}] ${res.status} len=${t.length}:`, t.replace(/\s+/g, ' ').slice(0, 400));
    return t;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message}`);
    return null;
  }
}

const B = 'https://api-pc.pxb7.com';
await req('api-game', `${B}/api/product/web/game?pageNum=1&pageSize=10`);
await req('api-game-post', `${B}/api/product/web/game`, { method: 'POST', body: { pageNum: 1, pageSize: 10 } });
await req('api-search', `${B}/api/search?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80&pageNum=1&pageSize=10`);
await req('api-gw-search', `${B}/api/gateway-open/search`, { method: 'POST', body: { keyword: '王者荣耀', pageNum: 1, pageSize: 10 } });
await req('api-gw-zone', `${B}/api/gateway-open/product/web/game/homeSpecialZone/gameList`, { method: 'POST', body: { pageNum: 1, pageSize: 10 } });
