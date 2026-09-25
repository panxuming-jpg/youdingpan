// 深入探测：分析各平台页面结构与数据形态
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(name, url, save) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (save) {
      const fs = await import('node:fs');
      fs.writeFileSync(save, text);
      console.log(`[${name}] status=${res.status} len=${text.length} -> saved ${save}`);
    } else {
      console.log(`[${name}] status=${res.status} len=${text.length}`);
    }
    return text;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
    return null;
  }
}

function extractHrefs(html, pattern, limit = 15) {
  const re = /href="([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    if (pattern.test(m[1])) out.push(m[1]);
  }
  return out;
}

// 1. pzds.com 确认是否盼之代售 + 找游戏列表 URL 模式
const pzds = await get('pzds', 'https://www.pzds.com/', null);
if (pzds) {
  const title = (pzds.match(/<title>([^<]*)<\/title>/) || [])[1];
  console.log('[pzds] title =', title);
  console.log('[pzds] game links:', extractHrefs(pzds, /(wangzhe|wzry|game|listing|category|hudong|account)/i, 20));
}

// 2. 7881 首页找游戏列表 URL 模式
const e7881 = await get('7881', 'https://www.7881.com/', null);
if (e7881) {
  const title = (e7881.match(/<title>([^<]*)<\/title>/) || [])[1];
  console.log('[7881] title =', title);
  console.log('[7881] links sample:', extractHrefs(e7881, /(wangzhe|wzry|zhanji|delta|valorant|wuqi|account|accountTrade|yunying)/i, 20));
  console.log('[7881] all link domains:', [...new Set(extractHrefs(e7881, /^https?:\/\//, 40))].slice(0, 20));
}

// 3. 5173 首页找游戏 URL 模式
const s5173 = await get('5173', 'https://www.5173.com/', null);
if (s5173) {
  const title = (s5173.match(/<title>([^<]*)<\/title>/) || [])[1];
  console.log('[5173] title =', title);
  console.log('[5173] links sample:', extractHrefs(s5173, /(wzry|wangzhe|jiaoyi|sale|goods)/i, 20));
}

// 4. pangxie 换写法重试 + 常见别名域名
for (const u of ['https://pangxie.com/', 'http://www.pangxie.com/', 'https://www.px000.com/', 'https://www.pangxiezhanghao.com/']) {
  await get('pangxie-try', u, null);
}

// 5. 交易猫搜索页保存分析
await get('jiaoyimao-search', 'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', 'jym_search.html');

// 6. 藏宝阁首页内容看一眼（10KB 是什么）
await get('cbg', 'https://cbg.163.com/', 'cbg_home.html');
