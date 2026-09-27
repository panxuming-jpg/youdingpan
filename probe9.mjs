// 第九轮：用户指定平台地址验证 + 接口挖掘
// 螃蟹 pxb7.com / 盼之 pzds.com / 交易猫 jiaoyimao.com / 7881
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

async function post(name, url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://www.7881.com', 'Referer': 'https://www.7881.com/', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    console.log(`[${name}] status=${res.status} len=${text.length}`);
    return text;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message}`);
    return null;
  }
}

// 1. 螃蟹 pxb7.com 首页 + 目标游戏
const px = await get('pxb7-home', 'https://www.pxb7.com/', 'pxb7_home.html');
if (px) {
  const title = (px.match(/<title>([^<]*)<\/title>/) || [])[1];
  console.log('[pxb7] title =', title);
  const links = [...new Set([...px.matchAll(/href="([^"]+)"/g)].map(m => m[1]))];
  const gameLinks = links.filter(h => /wzry|wangzhe|hpjy|heping|wwqy|wuwei|sjzx|sanjiao|zuhao|game|account|goods/i.test(h));
  console.log('[pxb7] 疑似游戏链接:', gameLinks.slice(0, 20));
  // 目标游戏文本附近
  for (const g of ['王者荣耀', '和平精英', '无畏契约', '三角洲']) {
    const i = px.indexOf(g);
    if (i >= 0) {
      const seg = px.slice(Math.max(0, i - 300), i + 100);
      const href = [...seg.matchAll(/href="([^"]+)"/g)].map(m => m[1]).pop();
      console.log(`[pxb7] ${g} 附近 href:`, href);
    } else {
      console.log(`[pxb7] ${g}: 未出现在首页`);
    }
  }
}

// 2. 7881：game-search API 拿 4 款游戏码
for (const g of ['王者荣耀', '和平精英', '无畏契约', '三角洲行动']) {
  const r = await post('7881-game-search:' + g, 'https://gw.7881.com/basic/api/game-search', { key: g, hotFlag: '', px: '', gameType: '' });
  if (r) {
    try {
      const d = JSON.parse(r);
      const list = (d.body || []).slice(0, 5).map(x => ({ name: x.gameName || x.name, code: x.gameId || x.gameCode || x.id, type: x.gameType }));
      console.log(`[7881] ${g} ->`, JSON.stringify(list), '| 原始字段:', d.body && d.body[0] ? Object.keys(d.body[0]).join(',') : '-');
    } catch { console.log('[7881] 返回非JSON:', r.slice(0, 200)); }
  }
}

// 3. 盼之：抓 gameList 页 __NUXT__ 全文找 config
const pz = fs.readFileSync('pzds_gamelist.html', 'utf8');
const nu = pz.indexOf('__NUXT__=');
const nuEnd = pz.indexOf('</script>', nu);
const nuTxt = pz.slice(nu, Math.min(nuEnd, nu + 3000));
console.log('[pzds] __NUXT__ 头 1000 字:', nuTxt.replace(/\s+/g, ' ').slice(0, 1000));

// 4. 交易猫：看重定向壳内容
const jw = fs.readFileSync('jym_wzry.html', 'utf8');
console.log('[jym-wzry壳]', jw.replace(/\s+/g, ' ').slice(0, 500));

// 5. 交易猫：游戏页带 Referer 再试
const jymGame2 = await get('jym-wzry-refer', 'https://www.jiaoyimao.com/g2416-c1/', 'jym_wzry2.html', { 'Referer': 'https://www.jiaoyimao.com/', 'Accept': 'text/html,application/xhtml+xml' });
if (jymGame2) {
  const pc = (jymGame2.match(/¥/g) || []).length;
  console.log('[jym-wzry-refer] ¥ 次数:', pc, '| /goods/ 链接:', [...new Set([...jymGame2.matchAll(/href="([^"]*goods[^"]*)"/g)].map(m => m[1]))].slice(0, 5));
}
