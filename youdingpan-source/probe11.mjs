// 第十一轮：静态挖 7881 search JS 与 pxb7 entry JS 的 API
const fs = await import('node:fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(name, url, save) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow', signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    if (save) fs.writeFileSync(save, text);
    console.log(`[${name}] status=${res.status} len=${text.length}`);
    return text;
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message}`);
    return null;
  }
}

// 1. 7881 search-2024-v6.js 商品搜索 API
const s7881 = await get('7881-search6', 'https://static.7881.com/7881/js/search-2024-v6.js?v=v20260922.1', 'a7881_search6.js');
if (s7881) {
  const gw = [...new Set([...s7881.matchAll(/["']([^"']*(?:gw\.7881\.com|search\.7881\.com|trade\.7881\.com)[^"']*)["']/g)].map(m => m[1]))];
  console.log('[7881-search6] 域名端点:', gw.slice(0, 25));
  const apis = [...new Set([...s7881.matchAll(/(?:url|api|path)\s*[:=]\s*["']([^"']{4,80})["']/g)].map(m => m[1]).filter(p => /\//.test(p)))];
  console.log('[7881-search6] url= 定义:', apis.slice(0, 30));
}

// 2. pxb7 entry.js
const pxEntry = await get('pxb7-entry', 'https://g.pxb7.com/pc/version/2_10_33/entry.BMfz9KKO.js', 'pxb7_entry.js');
if (pxEntry) {
  const apis = [...new Set([...pxEntry.matchAll(/["']([^"']*(?:\/api\/|\/gateway|api\.pxb7|pxb7\.com\/[a-z])[^"']{0,60})["']/g)].map(m => m[1]))];
  console.log('[pxb7-entry] API:', apis.slice(0, 30));
  const bases = [...new Set([...pxEntry.matchAll(/baseURL[^,;)]{0,80}|VITE_[A-Z_]+|https?:\/\/[a-z0-9.-]*pxb7[a-z0-9.-]*[^"'\s)]{0,40}/g)].map(m => m[0]))];
  console.log('[pxb7-entry] baseURL/域名:', bases.slice(0, 20));
  // 常见请求路径
  const paths = [...new Set([...pxEntry.matchAll(/["'](\/[a-z][a-zA-Z0-9/_-]{4,60})["']/g)].map(m => m[1]).filter(p => /goods|search|game|list|account/i.test(p)))];
  console.log('[pxb7-entry] 路径:', paths.slice(0, 30));
}
