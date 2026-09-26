// 第十三轮：7881 SSR确认 + 螃蟹真实API路径 + 交易猫模块定位
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 1. 7881："元" 上下文确认是否 SSR 商品
const w = fs.readFileSync('a7881_wzry.html', 'utf8');
let idx = -1, shown = 0;
while ((idx = w.indexOf('元', idx + 1)) >= 0 && shown < 3) {
  console.log('[7881-wzry] 元@' + idx + ':', w.slice(Math.max(0, idx - 300), idx + 60).replace(/\s+/g, ' ').slice(0, 320));
  shown++;
}

// 2. 螃蟹：openPlatApiUrl / baseUrl / dotEnv 的值
const pe = fs.readFileSync('pxb7_entry.js', 'utf8');
for (const k of ['openPlatApiUrl', 'baseUrl:', 'dotEnv', 'public:']) {
  let i = -1, n = 0;
  while ((i = pe.indexOf(k, i + 1)) >= 0 && n < 3) {
    console.log(`[pxb7] "${k}"@${i}:`, pe.slice(Math.max(0, i - 150), i + 250).replace(/\s+/g, ' ').slice(0, 350));
    n++;
  }
}

// 3. 螃蟹：试真实 API 路径
async function tryGet(name, url, extra = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.pxb7.com', 'Referer': 'https://www.pxb7.com/', ...extra },
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    console.log(`[${name}] ${res.status} len=${t.length}:`, t.replace(/\s+/g, ' ').slice(0, 300));
    return t;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message}`);
    return null;
  }
}
await tryGet('pxb7-api-game', 'https://www.pxb7.com/api/gateway-open/product/web/game');
await tryGet('pxb7-api-game-n', 'https://www.pxb7.com/api/product/web/game');
await tryGet('pxb7-api-search', 'https://www.pxb7.com/api/gateway-open/search?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80');

// 4. 交易猫：sea 模块配置定位 search 模块
const jym = fs.readFileSync('jym_search.html', 'utf8');
const gStart = jym.indexOf('window.gameList = [');
const gEnd = jym.indexOf('</script>', gStart);
const rest = jym.slice(0, gStart) + jym.slice(gEnd + 9);
for (const k of ['sea.config', 'seajs.config', 'alias', 'paths:', 'image.jiaoyimao.com/public/pc/js']) {
  let i = -1, n = 0;
  while ((i = rest.indexOf(k, i + 1)) >= 0 && n < 2) {
    console.log(`[jym] "${k}"@${i}:`, rest.slice(Math.max(0, i - 100), i + 350).replace(/\s+/g, ' ').slice(0, 420));
    n++;
  }
}
