// 第四轮：解析已保存页面 + 挖各平台数据结构
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(name, url, save) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
        redirect: 'follow', signal: AbortSignal.timeout(40000),
      });
      const text = await res.text();
      if (save) fs.writeFileSync(save, text);
      console.log(`[${name}] status=${res.status} len=${text.length}${save ? ' saved' : ''}`);
      return text;
    } catch (e) {
      console.log(`[${name}] try${i + 1} ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

// 1. 交易猫搜索页：看 SSR 商品结构（找重复的 class / 卡片结构）
const jym = fs.readFileSync('jym_search.html', 'utf8');
// 找价格附近的结构
const pIdx = jym.indexOf('"price"');
console.log('[jym] price 上下文:', jym.slice(pIdx - 1500, pIdx + 500).replace(/\s+/g, ' ').slice(0, 1200));
// 找常见卡片 class
for (const cls of ['goods-item', 'goods-card', 'item-card', 'search-item', 'product-', 'goods_', 'data-spm-item']) {
  const i = jym.indexOf(cls);
  if (i >= 0) console.log(`[jym] class "${cls}" at`, i);
}
// 数一下出现频率最高的嫌疑 class
const classCount = {};
const cre = /class="([a-z-]*(?:item|card|goods|product)[a-z-]*)"/g;
let cm;
while ((cm = cre.exec(jym))) classCount[cm[1]] = (classCount[cm[1]] || 0) + 1;
console.log('[jym] 疑似卡片class频次:', JSON.stringify(Object.entries(classCount).sort((a, b) => b[1] - a[1]).slice(0, 10)));

// 2. 5173 首页：王者荣耀附近的链接
const s5173 = fs.readFileSync('5173_home.html', 'utf8');
const gi = s5173.indexOf('王者荣耀');
console.log('[5173] 王者荣耀 ±800 上下文:', s5173.slice(Math.max(0, gi - 500), gi + 300).replace(/\s+/g, ' ').slice(0, 900));

// 3. 7881 gamelist 内容
const g7881 = fs.readFileSync('7881_gamelist.html', 'utf8');
const t7881 = g7881.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').replace(/\s+/g, ' ');
console.log('[7881] gamelist 文本:', t7881.slice(0, 600));

// 4. h5.7881.com 首页找游戏链接
const h5 = await get('h5-7881', 'https://h5.7881.com/', 'h5_7881.html');
if (h5) {
  const re = /href="([^"]*(zuhao|account|wzry|wangzhe)[^"]*)"/gi;
  const seen = new Set(); let m;
  while ((m = re.exec(h5)) && seen.size < 15) seen.add(m[1]);
  console.log('[h5-7881] links:', [...seen].slice(0, 15));
}

// 5. 盼之 gameList 页的 JS bundle，找 API 端点
const pz = fs.readFileSync('pzds_gamelist.html', 'utf8');
const bundles = [...pz.matchAll(/src="(\/[^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('[pzds] bundles:', bundles.slice(0, 8));
for (const b of bundles.slice(0, 3)) {
  const js = await get('pzds-bundle', 'https://www.pzds.com' + b, null);
  if (!js) continue;
  const apis = [...new Set([...js.matchAll(/["'](\/[a-z]+(?:\/[a-zA-Z0-9_-]+){1,5})["']/g)].map(m => m[1]).filter(p => /api|gateway|list|game|goods|search/i.test(p)))];
  console.log(`[pzds] ${b.slice(0, 40)} API 端点:`, apis.slice(0, 25));
}

// 6. http://www.pangxie.com 8.5KB 是什么
const px1 = await get('pangxie-http', 'http://www.pangxie.com/', 'pangxie_http.html');
if (px1) {
  const t = px1.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  console.log('[pangxie-http] 文本:', t.slice(0, 300));
}
