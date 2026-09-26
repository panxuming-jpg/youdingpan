// 第十二轮：调螃蟹网关 API + 检查 7881 列表页内嵌数据
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function get(name, url, save, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
      redirect: 'follow', signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    if (save) fs.writeFileSync(save, text);
    console.log(`[${name}] status=${res.status} len=${text.length} ct=${res.headers.get('content-type')}`);
    return text;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
    return null;
  }
}

// 1. 7881 列表页：找商品数据（无¥，找"元"或其他价格格式）
const w = fs.readFileSync('a7881_wzry.html', 'utf8');
console.log('[7881-wzry] "元" 次数:', (w.match(/元/g) || []).length);
// 找疑似商品区块：标题/区服/价格
for (const k of ['goodsList', 'goodsTitle', 'price', 'sellerName', 'goods_price', 'priceStr', 'data-price']) {
  const i = w.indexOf(k);
  if (i >= 0) console.log(`[7881-wzry] "${k}" at`, i, ':', w.slice(Math.max(0, i - 100), i + 250).replace(/\s+/g, ' ').slice(0, 300));
}
// 看 script 变量赋值
const vars = [...new Set([...w.matchAll(/var\s+([a-zA-Z_][a-zA-Z0-9_]{2,30})\s*=/g)].map(m => m[1]))];
console.log('[7881-wzry] var 定义:', vars.slice(0, 40).join(', '));

// 2. 螃蟹网关：游戏列表 API 尝试
const r1 = await get('pxb7-game', 'https://www.pxb7.com/gateway-open/product/web/game', null, { 'Origin': 'https://www.pxb7.com', 'Referer': 'https://www.pxb7.com/' });
if (r1) console.log('[pxb7-game] head:', r1.replace(/\s+/g, ' ').slice(0, 400));
// 带参数
const r2 = await get('pxb7-game2', 'https://www.pxb7.com/gateway-open/product/web/game?gameName=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', null, { 'Referer': 'https://www.pxb7.com/' });
if (r2) console.log('[pxb7-game2] head:', r2.replace(/\s+/g, ' ').slice(0, 400));
// searchResult 路由是前端页面还是 API
const r3 = await get('pxb7-search', 'https://www.pxb7.com/gateway-open/buy/searchResult?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', null, { 'Referer': 'https://www.pxb7.com/' });
if (r3) console.log('[pxb7-search] head:', r3.replace(/\s+/g, ' ').slice(0, 400));

// 3. 螃蟹 entry.js 里 gateway-open 与 product/web/game 的调用上下文
const pe = fs.readFileSync('pxb7_entry.js', 'utf8');
let i = pe.indexOf('/product/web/game');
if (i >= 0) console.log('[pxb7-entry] product/web/game ctx:', pe.slice(Math.max(0, i - 400), i + 400).replace(/\s+/g, ' ').slice(0, 700));
i = pe.indexOf('/gateway-open/');
if (i >= 0) console.log('[pxb7-entry] gateway-open ctx:', pe.slice(Math.max(0, i - 300), i + 300).replace(/\s+/g, ' ').slice(0, 600));

// 4. 交易猫移动端 search（手机 UA）
const m1 = await get('m-jym-search', 'https://m.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', 'mjym_search.html', { 'User-Agent': MUA });
if (m1) {
  const pc = (m1.match(/¥/g) || []).length;
  console.log('[m-jym-search] ¥ 次数:', pc, '| len:', m1.length);
  const p = /¥\s*([\d,.]+)/.exec(m1);
  if (p) {
    const j = m1.indexOf(p[0]);
    console.log('[m-jym-search] 首价格 ctx:', m1.slice(Math.max(0, j - 600), j + 300).replace(/\s+/g, ' ').slice(0, 700));
  }
}
