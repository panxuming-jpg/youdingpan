// 第三轮探测：定位各平台"王者荣耀"等目标游戏的列表页
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const fs = await import('node:fs');

async function get(name, url, save, headers = {}) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(40000),
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

function findGameLinks(html, names) {
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([^<]{0,40})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const text = m[2].trim();
    for (const n of names) {
      if (text.includes(n) || m[1].includes(encodeURIComponent(n))) {
        out.push({ text, href: m[1] });
        break;
      }
    }
  }
  return out;
}

// 1. 盼之 gameList 页
const pzList = await get('pzds-gameList', 'https://www.pzds.com/gameList', 'pzds_gamelist.html');
if (pzList) {
  console.log('[pzds] 王者 links:', JSON.stringify(findGameLinks(pzList, ['王者', '和平', '无畏', '三角洲'])).slice(0, 800));
  // Nuxt 数据在 window.__NUXT__
  const nu = pzList.indexOf('__NUXT__');
  console.log('[pzds] has __NUXT__:', nu >= 0, nu >= 0 ? pzList.slice(nu, nu + 200).replace(/\s+/g, ' ') : '');
}

// 2. 螃蟹首页
const px = await get('pangxie', 'https://www.pangxiezhanghao.com/', 'pangxie_home.html');
if (px) {
  const title = (px.match(/<title>([^<]*)<\/title>/) || [])[1];
  console.log('[pangxie] title =', title);
  console.log('[pangxie] game links:', JSON.stringify(findGameLinks(px, ['王者', '和平', '无畏', '三角洲'])).slice(0, 800));
}

// 3. 7881 gamelistshow
const g7881 = await get('7881-gamelist', 'https://www.7881.com/gamelistshow.html', '7881_gamelist.html');
if (g7881) {
  console.log('[7881] game links:', JSON.stringify(findGameLinks(g7881, ['王者', '和平', '无畏', '三角洲'])).slice(0, 800));
}

// 4. 5173 首页找目标游戏（未保存过，重新拿）
const s5173 = await get('5173-home', 'https://www.5173.com/', '5173_home.html');
if (s5173) {
  console.log('[5173] game links:', JSON.stringify(findGameLinks(s5173, ['王者', '和平', '无畏', '三角洲'])).slice(0, 800));
  const idx = s5173.indexOf('王者荣耀');
  console.log('[5173] 王者荣耀 出现位置:', idx, idx >= 0 ? s5173.slice(Math.max(0, idx - 200), idx + 100).replace(/\s+/g, ' ') : '');
}

// 5. 交易猫搜索页重试保存
const jym = await get('jym-search', 'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80', 'jym_search.html');
if (jym) {
  // 找内嵌数据结构
  for (const key of ['__INITIAL_STATE__', '__NUXT__', 'window.__', '"goodsList"', '"price"']) {
    const i = jym.indexOf(key);
    console.log(`[jym] "${key}" at`, i);
  }
}
