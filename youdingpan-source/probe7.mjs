// 第七轮：验证交易猫SSR + 找租号网/盼之/5173/7881 的接口
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

// 1. 交易猫王者荣耀真页面
const jymGame = await get('jym-wzry', 'https://www.jiaoyimao.com/g2416-c1/', 'jym_wzry.html');
if (jymGame) {
  const priceCount = (jymGame.match(/¥/g) || []).length;
  console.log('[jym-wzry] ¥ 出现:', priceCount, '次');
  // 找商品链接模式
  const goodsLinks = [...new Set([...jymGame.matchAll(/href="([^"]*\/goods\/[^"]*)"/g)].map(m => m[1]))];
  console.log('[jym-wzry] /goods/ 链接:', goodsLinks.slice(0, 5));
  // 找价格数字模式
  const p = /¥\s*([\d,.]+)/.exec(jymGame);
  if (p) {
    const i = jymGame.indexOf(p[0]);
    console.log('[jym-wzry] 首个价格 ctx:', jymGame.slice(Math.max(0, i - 600), i + 300).replace(/\s+/g, ' ').slice(0, 700));
  }
  // 是否有 JSON 数据
  for (const k of ['__INITIAL_STATE__', 'searchResult', '"goodsList"', 'window.pageData', 'window.__data']) {
    const i = jymGame.indexOf(k);
    if (i >= 0) console.log(`[jym-wzry] ${k} at`, i);
  }
}

// 2. 租号网列表页的 JS 文件
const pxList = fs.readFileSync('pangxie_list.html', 'utf8');
const pxJs = [...new Set([...pxList.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]))];
console.log('[pangxie] js files:', pxJs);
for (const jf of pxJs.slice(0, 8)) {
  const u = jf.startsWith('http') ? jf : 'https://www.pangxiezhanghao.com' + (jf.startsWith('/') ? '' : '/') + jf;
  const js = await get('pangxie-js', u, null);
  if (!js || js.length < 100) continue;
  const eps = [...new Set([...js.matchAll(/["'](\/[a-zA-Z][^"']{3,70})["']/g)].map(m => m[1]).filter(p => /api|search|zuhao|goods|list|ajax|get/i.test(p)))];
  if (eps.length) console.log(`[pangxie] ${jf.slice(0, 50)}:`, eps.slice(0, 20));
}

// 3. 藏宝阁首页 ajax 端点
const cbg = fs.readFileSync('cbg_home.html', 'utf8');
const ajaxs = [...new Set([...cbg.matchAll(/["'](\/[^"']{3,80})["']/g)].map(m => m[1]).filter(p => /api|json|action|query|list|get/i.test(p)))];
console.log('[cbg] 端点线索:', ajaxs.slice(0, 20));

// 4. 7881 gamelist 页的 JS
const g7881 = fs.readFileSync('7881_gamelist.html', 'utf8');
const g7881Js = [...new Set([...g7881.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]))];
console.log('[7881-gamelist] js:', g7881Js);
for (const jf of g7881Js.slice(0, 6)) {
  const u = jf.startsWith('http') ? jf : 'https://www.7881.com' + jf;
  const js = await get('7881-gjs', u, null);
  if (!js) continue;
  const eps = [...new Set([...js.matchAll(/["'](\/[^"']{3,80}|https?:\/\/[^"']{5,90})["']/g)].map(m => m[1]).filter(p => /game|search|api|action|\.do|list/i.test(p)))];
  if (eps.length) console.log(`[7881-gjs] ${jf.slice(0, 45)}:`, eps.slice(0, 25));
}

// 5. 盼之 m 站与常见 API 猜测
for (const u of ['https://m.pzds.com/', 'https://www.pzds.com/api/gameList', 'https://www.pzds.com/openapi/gameList']) {
  const r = await get('pzds-try', u, null);
  if (r && r.length > 0) {
    const t = (r.match(/<title>([^<]*)<\/title>/) || [])[1];
    console.log('[pzds-try] title:', t, '| head:', r.slice(0, 150).replace(/\s+/g, ' '));
  }
}

// 6. 5173 首页 JS bundle 与接口
const s5173 = fs.readFileSync('5173_home.html', 'utf8');
const s5173Js = [...new Set([...s5173.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]))];
console.log('[5173] js files:', s5173Js.slice(0, 10));
for (const k of ['gameList', 'getGame', '/api/', 'api.5173', 'searchGoods']) {
  const i = s5173.indexOf(k);
  if (i >= 0) console.log(`[5173] "${k}" ctx:`, s5173.slice(Math.max(0, i - 100), i + 150).replace(/\s+/g, ' '));
}
