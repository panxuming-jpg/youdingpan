// 第十轮：pxb7 壳解析 + 7881 列表页验证 + 盼之/交易猫 API
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(name, url, save, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
      redirect: 'follow', signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    if (save) fs.writeFileSync(save, text);
    console.log(`[${name}] status=${res.status} len=${text.length} final=${res.url}`);
    return text;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
    return null;
  }
}

// 1. 螃蟹 pxb7 壳内容全文
const px = fs.readFileSync('pxb7_home.html', 'utf8');
console.log('[pxb7] 全文:\n', px.replace(/\s+/g, ' ').slice(0, 1800));

// 2. 7881 王者荣耀账号列表页（A2705-100001）
const l7881 = await get('7881-wzry-list', 'https://search.7881.com/A2705-100001-0-0-0.html?pageNum=1', 'a7881_wzry.html');
if (l7881) {
  const priceCount = (l7881.match(/¥/g) || []).length;
  console.log('[7881-wzry] ¥ 次数:', priceCount);
  // 找商品标题/价格结构
  const p = /¥\s*([\d,.]+)/.exec(l7881);
  if (p) {
    const i = l7881.indexOf(p[0]);
    console.log('[7881-wzry] 首价格 ctx:', l7881.slice(Math.max(0, i - 800), i + 400).replace(/\s+/g, ' ').slice(0, 900));
  } else {
    // 无 SSR → 找 XHR 线索
    const scripts = [...new Set([...l7881.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]))];
    console.log('[7881-wzry] js:', scripts.slice(0, 12));
    for (const k of ['search-api', 'searchApi', 'search.7881.com/api', 'gw.7881.com', 'ajax']) {
      const i = l7881.indexOf(k);
      if (i >= 0) console.log(`[7881-wzry] "${k}":`, l7881.slice(Math.max(0, i - 100), i + 150).replace(/\s+/g, ' '));
    }
  }
}

// 3. 盼之：前几个 chunk 找 API base
const pz = fs.readFileSync('pzds_gamelist.html', 'utf8');
const chunks = [...new Set([...pz.matchAll(/src="(https:\/\/oss\.pzds\.com\/pzdspcssr\/[^"]+\.js)"/g)].map(m => m[1]))];
console.log('[pzds] chunk 总数:', chunks.length);
for (const c of chunks.slice(0, 8)) {
  const js = await get('pzds-chunk', c, null);
  if (!js) continue;
  const urls = [...new Set([...js.matchAll(/["']([^"']*(?:https?:\/\/|\/\/)[a-z0-9.-]+\.[a-z]{2,6}[^"']{0,50})["']/g)].map(m => m[1]).filter(p => !/\.(png|jpg|gif|css|woff|svg)/i.test(p)))];
  const apis = urls.filter(p => /api|gw|gateway|open|service/i.test(p));
  if (apis.length) console.log(`[pzds] ${c.split('/').pop()}:`, apis.slice(0, 10));
}

// 4. 交易猫：search 页里非 gameList 的 XHR 线索
const jym = fs.readFileSync('jym_search.html', 'utf8');
// 移除 gameList 大块后再找
const gStart = jym.indexOf('window.gameList = [');
const gEnd = jym.indexOf('</script>', gStart);
const jymRest = jym.slice(0, gStart) + jym.slice(gEnd + 9);
for (const k of ['searchGoods', 'search/goods', 'mtop', 'h5api', 'api.jiaoyimao', 'so.jiaoyimao', '/search', 'getGoods', 'goodsList', 'ajax']) {
  let i = -1, found = 0;
  while ((i = jymRest.indexOf(k, i + 1)) >= 0 && found < 2) {
    console.log(`[jym] "${k}" ctx:`, jymRest.slice(Math.max(0, i - 120), i + 150).replace(/\s+/g, ' ').slice(0, 220));
    found++;
  }
}
