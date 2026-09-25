// 探测螃蟹商品列表 ajax 接口路径
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const REFERER = 'https://www.pxb7.com/buy/10013/1';
const ORIGIN = 'https://www.pxb7.com';

const postEndpoints = [
  // 模仿 selectSearchOption 的接口模式
  ['https://api-pc.pxb7.com/api/product/web/gameBizProd/productPage', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/product/web/gameBizProd/v1/productPage', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/product/web/product/page', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/product/web/product/list', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/product/web/productPage/list', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/product/web/gameBizProd/list', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/product/web/gameBizProd/getProductPage', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/search/web/product/search', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
  ['https://api-pc.pxb7.com/api/search/web/search', { gameId: '10013', bizProd: 1, pageNum: 1, pageSize: 20 }],
];

for (const [u, body] of postEndpoints) {
  try {
    const res = await fetch(u, {
      method: 'POST', headers: {
        'User-Agent': UA, 'Referer': REFERER, 'Origin': ORIGIN,
        'Content-Type': 'application/json;charset=UTF-8', 'Accept': 'application/json',
      },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const t = await res.text();
    const ok = res.status === 200 && t.length > 200 && !t.includes('<!doctype');
    console.log(`\n[${res.status}] len=${t.length} ${ok ? '★' : ''} ${u}`);
    if (ok) console.log('  head=', t.replace(/\s+/g, ' ').slice(0, 500));
  } catch (e) {
    console.log(`\n[ERR] ${u} ${e.message}`);
  }
}
