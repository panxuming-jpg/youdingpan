// 第八轮：挖各平台 XHR 接口
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
    console.log(`[${name}] status=${res.status} len=${text.length}`);
    return text;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message} cause=${e.cause ? (e.cause.code || e.cause.message) : '-'}`);
    return null;
  }
}

// 1. 交易猫：seajs 模块名 -> 找 search 模块 JS
const jym = fs.readFileSync('jym_search.html', 'utf8');
const seajsUses = [...jym.matchAll(/seajs\.use\((\[[^\]]*\])/g)].map(m => m[1]);
console.log('[jym] seajs.use:', seajsUses.slice(0, 10));
const jymScripts = [...jym.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('[jym] script srcs:', jymScripts.slice(0, 15));
// m 站
const mjym = await get('m-jym', 'https://m.jiaoyimao.com/', null);

// 2. 租号网：保存并 grep main-search.js / search_v2.js
const ms = await get('pangxie-mainsearch', 'https://static.zhanghaodaren.cn/zhdrpc/js/main-search.js?v=20260910', 'px_mainsearch.js');
const sv2 = await get('pangxie-searchv2', 'https://www.pangxiezhanghao.com/static/scripts/common/search_v2.js?v=202609221024', 'px_searchv2.js');
for (const [tag, js] of [['mainsearch', ms], ['searchv2', sv2]]) {
  if (!js) continue;
  const urls = [...new Set([...js.matchAll(/["'](\/[a-zA-Z][^"'\s]{3,80})["']/g)].map(m => m[1]).filter(p => /\.(do|action|json)|\/(api|goods|search|zuhao|game)/i.test(p)))];
  console.log(`[pangxie:${tag}] URL:`, urls.slice(0, 30));
  const ajax = [...new Set([...js.matchAll(/(?:url|ajax|post|get)\s*[:=(]\s*["']([^"']{4,80})["']/g)].map(m => m[1]))];
  console.log(`[pangxie:${tag}] ajax:`, ajax.slice(0, 30));
}

// 3. 7881：accountTrade.js 中 game-search 调用方式 + gw 端点全集
const at = await get('7881-accountTrade', 'https://static.7881.com/7881/js/account_trade/accountTrade.js?v=v20260922.1', 'a7881_at.js');
if (at) {
  const i = at.indexOf('game-search');
  console.log('[7881:at] game-search ctx:', at.slice(Math.max(0, i - 300), i + 300).replace(/\s+/g, ' '));
  const gw = [...new Set([...at.matchAll(/["']([^"']*gw\.7881\.com[^"']*)["']/g)].map(m => m[1]))];
  console.log('[7881:at] gw 端点:', gw.slice(0, 15));
}
const main7881 = await get('7881-2016', 'https://static.7881.com/7881/js/7881-2016.js?v=v20260922.1', 'a7881_2016.js');
if (main7881) {
  const gw = [...new Set([...main7881.matchAll(/["']([^"']*gw\.7881\.com[^"']*)["']/g)].map(m => m[1]))];
  console.log('[7881:2016] gw 端点:', gw.slice(0, 20));
}

// 4. 盼之：HTML 里找 config / apiBase
const pz = fs.readFileSync('pzds_gamelist.html', 'utf8');
for (const k of ['baseURL', 'apiBase', 'API_BASE', 'axios', 'gateway', 'serviceUrl', 'host']) {
  const i = pz.indexOf(k);
  if (i >= 0) console.log(`[pzds] "${k}":`, pz.slice(Math.max(0, i - 100), i + 180).replace(/\s+/g, ' '));
}

// 5. 藏宝阁：内联脚本看数据源
const cbg = fs.readFileSync('cbg_home.html', 'utf8');
const inline = [...cbg.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim().length > 50);
console.log('[cbg] 内联脚本数:', inline.length);
for (const s of inline) {
  const urls = [...new Set([...s.matchAll(/["']([^"']*(?:http|\.json|\.do|action|api)[^"']{2,90})["']/g)].map(m => m[1]))];
  if (urls.length) console.log('[cbg] urls:', urls.slice(0, 15));
}

// 6. 5173：内联脚本 XHR 线索
const s5173 = fs.readFileSync('5173_home.html', 'utf8');
const inline5 = [...s5173.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim().length > 100);
console.log('[5173] 内联脚本数:', inline5.length);
for (const s of inline5) {
  const urls = [...new Set([...s.matchAll(/["'](https?:\/\/[^"']{5,100}|\/[a-z][^"'\s]{3,80})["']/g)].map(m => m[1]).filter(p => /api|game|list|query|search|json/i.test(p)))];
  if (urls.length) console.log('[5173] urls:', urls.slice(0, 20));
}
