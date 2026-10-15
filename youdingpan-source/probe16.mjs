// 第十六轮：直测三个已知商品接口
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function req(name, url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': opts.origin || 'https://www.7881.com', 'Referer': opts.referer || 'https://www.7881.com/',
        ...(opts.headers || {}),
      },
      method: opts.method || 'POST',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    console.log(`\n[${name}] ${res.status} len=${t.length}`);
    console.log(t.slice(0, 1500));
    return t;
  } catch (e) {
    console.log(`\n[${name}] ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
    return null;
  }
}

function showStructure(tag, jsonText) {
  try {
    const d = JSON.parse(jsonText);
    // 递归找数组
    const find = (o, path, depth) => {
      if (depth > 4 || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        if (o.length && typeof o[0] === 'object') {
          console.log(`[${tag}] 数组 ${path} 长度${o.length} 首元素字段:`, Object.keys(o[0]).join(','));
        }
        return;
      }
      for (const k of Object.keys(o).slice(0, 30)) find(o[k], path + '.' + k, depth + 1);
    };
    find(d, 'root', 0);
  } catch (e) { /* not json */ }
}

// 1. 7881 商品列表
const r1 = await req('7881-goods-list', 'https://gw.7881.com/goods-service-api/api/goods/list', {
  body: { gameId: 'A2705', goodsType: 100001, pageNum: 1, pageSize: 20 },
});
if (r1) showStructure('7881', r1);

// 2. 螃蟹 商品分页
const r2 = await req('pxb7-productPage', 'https://api-pc.pxb7.com/api/bff/web/product/search/productPage', {
  origin: 'https://www.pxb7.com', referer: 'https://www.pxb7.com/',
  body: { pageNum: 1, pageSize: 20, gameId: 'A2705' },
});
if (r2) showStructure('pxb7', r2);

// 3. 盼之 游戏列表
const r3 = await req('pzds-game-all', 'https://api.pzds.com/api/web-client/v2/homepage/public/game/all', {
  origin: 'https://www.pzds.com', referer: 'https://www.pzds.com/',
  body: {},
});
if (r3) {
  showStructure('pzds-games', r3);
  // 找王者荣耀的 ID
  try {
    const d = JSON.parse(r3);
    const s = JSON.stringify(d);
    const i = s.indexOf('王者荣耀');
    if (i >= 0) console.log('[pzds] 王者荣耀 ctx:', s.slice(Math.max(0, i - 200), i + 100));
    else console.log('[pzds] 未含王者荣耀，前 800 字:', s.slice(0, 800));
  } catch {}
}
