// 平台连通性探测脚本（node probe.mjs）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TARGETS = [
  // [名称, URL]
  ['jiaoyimao-home', 'https://www.jiaoyimao.com/'],
  ['jiaoyimao-search', 'https://www.jiaoyimao.com/search/?keyword=%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80'],
  ['7881-home', 'https://www.7881.com/'],
  ['5173-home', 'https://www.5173.com/'],
  ['pangxie-home', 'https://www.pangxie.com/'],
  ['cangbaoge-home', 'https://cbg.163.com/'],
  // 盼之代售 域名候选
  ['panzhi-cand1', 'https://www.panzhi.com/'],
  ['panzhi-cand2', 'https://www.pzds.com/'],
  ['panzhi-cand3', 'https://www.panzhidaihai.com/'],
];

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    const head = text.replace(/\s+/g, ' ').slice(0, 300);
    console.log(JSON.stringify({ name, url, status: res.status, ct: res.headers.get('content-type'), len: text.length, ms, finalUrl: res.url }));
    console.log('  HEAD: ' + head);
  } catch (e) {
    console.log(JSON.stringify({ name, url, error: String(e && e.message || e), ms: Date.now() - t0 }));
  }
}

for (const [name, url] of TARGETS) {
  await probe(name, url);
}
