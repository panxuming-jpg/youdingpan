// 第十八轮：盼之 goodsPublic/page 参数摸索
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function req(name, url, body, method = 'POST') {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA, 'Accept': 'application/json',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://www.pzds.com', 'Referer': 'https://www.pzds.com/',
      },
      method, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    console.log(`\n[${name}] ${res.status} len=${t.length}`);
    console.log(t.replace(/\s+/g, ' ').slice(0, 800));
    return t;
  } catch (e) {
    console.log(`\n[${name}] ERROR: ${e.message}`);
    return null;
  }
}

const PAGE = 'https://api.pzds.com/api/web-client/v2/public/goodsPublic/page';
const ES = 'https://api.pzds.com/api/web-client/v2/public/goodsPublic/es/retrieve/goods';

// 参数名猜测（读报错迭代）
let r = await req('page-empty', PAGE, {});
if (r) {
  // 从报错里读缺什么字段
  const m = r.match(/"info":"([^"]+)"/);
  console.log('>> info:', m && m[1]);
}
await req('page-gid7', PAGE, { gameId: 7 });
await req('page-gid7-pn', PAGE, { gameId: 7, pageNum: 1, pageSize: 20 });
await req('page-gid7-current', PAGE, { gameId: 7, current: 1, size: 20 });
await req('es-gid7', ES, { gameId: 7, pageIndex: 1, pageSize: 20 });
