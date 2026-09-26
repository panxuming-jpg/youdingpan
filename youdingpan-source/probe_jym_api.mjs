// 直接试调用交易猫可能的 ajax 商品列表接口
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const REFERER = 'https://www.jiaoyimao.com/';

const endpoints = [
  // GamesAjax 已知存在，模仿它推 GoodsAjax
  'https://www.jiaoyimao.com/pc/ajax/GoodsAjax/getGoodsListByGame?gameId=2416&page=1',
  'https://www.jiaoyimao.com/pc/ajax/GoodsAjax/getGoodsListByGameId?gameId=2416&page=1',
  'https://www.jiaoyimao.com/pc/ajax/GoodsAjax/getGoodsList?gameId=2416&page=1',
  'https://www.jiaoyimao.com/pc/ajax/GoodsAjax/getGoodsByGameId?gameId=2416',
  'https://www.jiaoyimao.com/pc/ajax/GoodsAjax/search?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80&page=1',
  'https://www.jiaoyimao.com/pc/ajax/GoodsAjax/getGoodsListByGameId?gameId=2416&pageSize=20',
  'https://www.jiaoyimao.com/pc/ajax/GamesAjax/getGoodsList?gameId=2416',
  'https://www.jiaoyimao.com/pc/ajax/SearchAjax/search?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80',
  'https://www.jiaoyimao.com/pc/ajax/SearchAjax/getGoodsList?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80',
  'https://www.jiaoyimao.com/pc/ajax/GameGoodsAjax/getList?gameId=2416',
  'https://www.jiaoyimao.com/pc/ajax/GameAjax/getGoods?gameId=2416',
  'https://www.jiaoyimao.com/pc/ajax/goods/list?gameId=2416',
];

for (const u of endpoints) {
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
    const t = await res.text();
    console.log(`\n[${res.status}] ${u}`);
    console.log('  len=', t.length, 'head=', t.replace(/\s+/g, ' ').slice(0, 250));
  } catch (e) {
    console.log(`\n[ERR] ${u} ${e.message}`);
  }
}

// 也试 POST 形式
const postEndpoints = [
  ['https://www.jiaoyimao.com/pc/ajax/GoodsAjax/getGoodsList', { gameId: 2416, page: 1 }],
  ['https://www.jiaoyimao.com/pc/ajax/GoodsAjax/search', { keyword: '王者荣耀', page: 1 }],
  ['https://www.jiaoyimao.com/pc/ajax/SearchAjax/search', { keyword: '王者荣耀', page: 1, pageSize: 20 }],
];
for (const [u, body] of postEndpoints) {
  try {
    const res = await fetch(u, {
      method: 'POST', headers: { 'User-Agent': UA, 'Referer': REFERER, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const t = await res.text();
    console.log(`\n[POST ${res.status}] ${u}`);
    console.log('  len=', t.length, 'head=', t.replace(/\s+/g, ' ').slice(0, 250));
  } catch (e) {
    console.log(`\n[POST ERR] ${u} ${e.message}`);
  }
}
