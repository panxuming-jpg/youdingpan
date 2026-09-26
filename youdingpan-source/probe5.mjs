// 第五轮：各平台 API 端点与数据结构深挖
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(name, url, save, timeout = 40000) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
        redirect: 'follow', signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      if (save) fs.writeFileSync(save, text);
      console.log(`[${name}] status=${res.status} len=${text.length}${save ? ' saved' : ''}`);
      return text;
    } catch (e) {
      console.log(`[${name}] try${i + 1} ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// 1. 交易猫：script 块里的数据 & API 线索
const jym = fs.readFileSync('jym_search.html', 'utf8');
const scripts = [...jym.matchAll(/<script(?:\s+id="([^"]*)")?[^>]*>([\s\S]*?)<\/script>/g)];
console.log('[jym] script 块数:', scripts.length);
scripts.forEach((s, i) => {
  const body = s[2];
  if (body.length > 500) console.log(`  #${i} id=${s[1] || '-'} len=${body.length} head=${body.slice(0, 120).replace(/\s+/g, ' ')}`);
});
// 找 API 线索
for (const kw of ['mtop', '/api/', 'ajax', 'fetch(', 'axios', 'searchGoods', 'goods/search', 'h5api', 'amap', 'open.jiaoyimao']) {
  const idx = jym.indexOf(kw);
  if (idx >= 0) console.log(`[jym] kw "${kw}" at`, idx, ' ctx:', jym.slice(Math.max(0, idx - 80), idx + 120).replace(/\s+/g, ' '));
}

// 2. 5173：王者荣耀 game-item 最近的 href + 路由线索
const s5173 = fs.readFileSync('5173_home.html', 'utf8');
const gi = s5173.indexOf('王者荣耀');
const before = s5173.slice(Math.max(0, gi - 3000), gi);
const hrefs = [...before.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
console.log('[5173] 王者荣耀 前最近的 href:', hrefs.slice(-3));
for (const kw of ['market', '/goods', 'account', 'zh/', 'sale']) {
  const idxs = [];
  let i = -1;
  while ((i = s5173.indexOf(kw, i + 1)) >= 0 && idxs.length < 3) idxs.push(i);
  if (idxs.length) console.log(`[5173] "${kw}" ctx:`, s5173.slice(idxs[0] - 60, idxs[0] + 80).replace(/\s+/g, ' '));
}

// 3. 7881：gamelist 的 JS 文件
const g7881 = fs.readFileSync('7881_gamelist.html', 'utf8');
const jsFiles = [...new Set([...g7881.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]))];
console.log('[7881] js files:', jsFiles);
for (const jf of jsFiles.slice(0, 4)) {
  const u = jf.startsWith('http') ? jf : 'https://www.7881.com' + jf;
  const js = await get('7881-js', u, null);
  if (!js) continue;
  const apis = [...new Set([...js.matchAll(/["']([^"']*(?:action|\.do|\/api\/|\/interface|\/json)[^"']*)["']/g)].map(m => m[1]))];
  if (apis.length) console.log(`[7881] ${jf.slice(0, 50)} 端点:`, apis.slice(0, 20));
}

// 4. 盼之：所有 script src（含相对路径）
const pz = fs.readFileSync('pzds_gamelist.html', 'utf8');
const pzJs = [...new Set([...pz.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]))];
console.log('[pzds] js files:', pzJs);
for (const jf of pzJs.slice(0, 6)) {
  const u = jf.startsWith('http') ? (jf.startsWith('//') ? 'https:' + jf : jf) : 'https://www.pzds.com' + jf;
  const js = await get('pzds-js', u, null);
  if (!js) continue;
  const apis = [...new Set([...js.matchAll(/["'](\/[a-zA-Z][^"']{2,60})["']/g)].map(m => m[1]).filter(p => /api|game|goods|list|search|gateway|open/i.test(p)))];
  if (apis.length) console.log(`[pzds] ${jf.slice(0, 50)} 端点:`, apis.slice(0, 30));
  const bases = [...new Set([...js.matchAll(/baseURL[^,;]{0,80}|https?:\/\/[a-z0-9.-]+pzds[^"'\s)]*/gi)].map(m => m[0]))];
  if (bases.length) console.log(`[pzds] ${jf.slice(0, 50)} base:`, bases.slice(0, 8));
}

// 5. 螃蟹=租号网？grep 首页
const px = fs.readFileSync('pangxie_home.html', 'utf8');
console.log('[pangxie] 螃蟹 出现:', (px.match(/螃蟹/g) || []).length, '次; 租号 出现:', (px.match(/租号/g) || []).length);
console.log('[pangxie] 底部文案:', px.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-400));

// 6. 螃蟹(租号网) 王者荣耀列表页结构
const pxList = await get('pangxie-list', 'https://www.pangxiezhanghao.com/zuhao-A2705-0-0-0-0-1', 'pangxie_list.html');
if (pxList) {
  // 找商品卡片结构
  const cardIdx = pxList.search(/(goods|item|card|product)[-_]/);
  console.log('[pangxie-list] 卡片class线索 at', cardIdx, pxList.slice(cardIdx - 100, cardIdx + 200).replace(/\s+/g, ' '));
}
