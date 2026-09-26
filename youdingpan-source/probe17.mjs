// 第十七轮：测试免签名 GET 接口 + 枚举盼之 API
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function req(name, url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    const isJson = t.trim().startsWith('{') || t.trim().startsWith('[');
    console.log(`[${name}] ${res.status} len=${t.length} json=${isJson}`);
    if (isJson) console.log('  ', t.replace(/\s+/g, ' ').slice(0, 500));
    else console.log('  ', t.replace(/\s+/g, ' ').slice(0, 120));
    return t;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
    return null;
  }
}

// 1. 螃蟹 GET selectPageList（免签名尝试）王者的 pzds gameId=7（bizProd=6）
await req('pxb7-selectList', 'https://api-pc.pxb7.com/api/search/product/selectPageList?gameId=7&pageIndex=1&pageSize=16&bizProd=1&type=1&posType=4', {
  headers: { 'Origin': 'https://www.pzds.com', 'Referer': 'https://www.pzds.com/' },
});
await req('pxb7-selectList-b6', 'https://api-pc.pxb7.com/api/search/product/selectPageList?gameId=7&pageIndex=1&pageSize=16&bizProd=6&type=1&posType=4', {
  headers: { 'Origin': 'https://www.pzds.com', 'Referer': 'https://www.pzds.com/' },
});

// 2. 盼之 api.pzds.com 试探
await req('pzds-config', 'https://api.pzds.com/api/web-client/v2/homepage/public/other/config', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.pzds.com', 'Referer': 'https://www.pzds.com/' }, body: {},
});
await req('pzds-catalogue', 'https://api.pzds.com/api/web-client/v2/homepage/public/game/catalogue', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.pzds.com', 'Referer': 'https://www.pzds.com/' }, body: {},
});

// 3. 盼之：枚举 chunks 里的 web-client 端点
const pz = fs.readFileSync('pzds_gamelist.html', 'utf8');
const chunks = [...new Set([...pz.matchAll(/src="(https:\/\/oss\.pzds\.com\/pzdspcssr\/[^"]+\.js)"/g)].map(m => m[1]))];
console.log('[pzds] 开始枚举', chunks.length, '个 chunk 找 web-client 端点...');
const found = new Set();
let done = 0;
const CONC = 12;
async function worker(queue) {
  while (queue.length) {
    const c = queue.shift();
    try {
      const res = await fetch(c, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      const js = await res.text();
      const re = /["'](\/api\/web-client\/[^"'\s]{3,80}|https:\/\/api\.pzds\.com[^"'\s]{3,80})["']/g;
      let m;
      while ((m = re.exec(js))) found.add(m[1]);
      // 也找 goods 相关路径
      const re2 = /["'](\/[a-z][a-zA-Z0-9/-]{3,60}\/(?:goods|product|search)[a-zA-Z0-9/-]{0,40})["']/g;
      while ((m = re2.exec(js))) {
        if (/goods|product|search/i.test(m[1]) && !m[1].includes('node_modules')) found.add('PATH:' + m[1]);
      }
    } catch {}
    done++;
  }
}
const queue = [...chunks];
await Promise.all(Array.from({ length: CONC }, () => worker(queue)));
console.log('[pzds] 枚举完成', done, '/', chunks.length);
const list = [...found];
console.log('[pzds] web-client 端点:', list.filter(x => !x.startsWith('PATH:')).slice(0, 60));
console.log('[pzds] goods/product 路径:', list.filter(x => x.startsWith('PATH:')).slice(0, 60));
