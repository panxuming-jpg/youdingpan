// 探测交易猫 PC 游戏页 DOM 结构，找商品卡片选择器
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
});

const url = 'https://www.jiaoyimao.com/g2416-c1/';
console.log('打开:', url);
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setViewport({ width: 1400, height: 900 });
const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => { console.log('goto err:', e.message); return null; });
console.log('goto status:', resp && resp.status());
await new Promise(r => setTimeout(r, 5000));

const title = await page.title().catch(() => '-');
console.log('页面 title:', title);
const finalUrl = await page.url();
console.log('最终 URL:', finalUrl);

// 检测是否被 punish 拦
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => '');
console.log('body 文本预览:', bodyText.slice(0, 300));

// 价格串数量
const priceCount = await page.evaluate(() => document.body.innerText.match(/¥\s*[\d,.]+|￥\s*[\d,.]+|\d+(?:\.\d+)?\s*元/g)?.length || 0).catch(() => 0);
console.log('价格串数:', priceCount);

// 找疑似商品卡片选择器
const probe = await page.evaluate(() => {
  const result = {};
  // 常见商品卡片 class 关键字
  const candidates = [
    '.goods-list li', '.goods-list-item', '.goods-item', '.goodsItem',
    '.list-item', '.goods-list-wrap li', '.account-item', '.product-item',
    '.search-list-item', '.J_goods_list li', '[data-goods-id]', '[data-spm]',
    'li.gooditem', '.item-con', '.J_ItemList li', '.gl-item',
    '.search-result-list li', '.goodsList li', '.gnrl-cnt', '.gnrl-item',
    '.goods-card', '.card-goods', '.goods_card', '.jym-goods-item'
  ];
  for (const sel of candidates) {
    try {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) result[sel] = els.length;
    } catch {}
  }
  // 也尝试用价格反推父节点
  const priceEls = [...document.querySelectorAll('*')].filter(el => {
    const t = el.textContent || '';
    return t.length < 30 && /^[\s¥￥]*(\d{1,5}(?:\.\d{1,2})?)\s*元?$/.test(t.trim());
  });
  result['__priceElCount'] = priceEls.length;
  if (priceEls.length) {
    // 找价格元素的某个父级 class
    const parents = new Set();
    for (const p of priceEls.slice(0, 5)) {
      let cur = p;
      for (let i = 0; i < 5 && cur; i++) {
        const cls = cur.className && typeof cur.className === 'string' ? cur.className : '';
        if (cls) parents.add(cls.split(' ')[0]);
        cur = cur.parentElement;
      }
    }
    result['__priceParentClasses'] = [...parents].slice(0, 10);
  }
  return result;
}).catch(() => ({}));
console.log('探测选择器:', JSON.stringify(probe, null, 2));

// dump 第一段有价格的容器 HTML
const sample = await page.evaluate(() => {
  const priceEls = [...document.querySelectorAll('*')].filter(el => {
    const t = (el.textContent || '').trim();
    return t.length < 30 && /^[\s¥￥]*(\d{1,5}(?:\.\d{1,2})?)\s*元?$/.test(t);
  });
  if (!priceEls.length) return null;
  // 找一个较深的包含卡片标题+价格的父级
  let card = priceEls[0];
  for (let i = 0; i < 6; i++) {
    if (card.parentElement) card = card.parentElement;
  }
  return card.outerHTML.slice(0, 2000);
}).catch(() => null);
console.log('\n商品卡片样本 HTML:\n', sample);

await browser.close();
