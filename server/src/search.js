/**
 * 商品关键词倒排索引（内存，服务启动时从 goods 表全量重建，入库时增量维护）
 *
 * 分词规则：
 * - 连续英文字母/数字 → 小写化为一个整词（如 "ios"、"v10"）
 * - 连续中文段 → bigram 滑窗（如 "胡桃护摩" → 胡桃/桃护/护摩）；单字直接作为一个 term
 *
 * 查询语义（query 分词）：
 * - query 按空格分组，如 "A B" → [terms(A), terms(B)]
 * - 组内所有 term 都命中 → 该组命中（组内 AND）
 * - 商品命中组数 = match_level：命中全部组的商品优先透出，只命中部分组的排后面
 *   （ORDER BY match_level DESC, 用户选择的排序键）
 */
import { db } from './db.js';

const index = new Map(); // term -> Set<goodsId>

/** 文本分词 → term 数组（可重复，调用方按需去重） */
export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const terms = [];
  const re = /[a-z0-9]+|[一-鿿]+/g;
  let m;
  while ((m = re.exec(s))) {
    const w = m[0];
    if (/^[a-z0-9]+$/.test(w)) { terms.push(w); continue; }
    if (w.length === 1) { terms.push(w); continue; }
    for (let i = 0; i < w.length - 1; i++) terms.push(w.slice(i, i + 2));
  }
  return terms;
}

/** 商品入库/重建时调用：把 title + server_name 的 term 挂到倒排表 */
export function addGoods(id, text) {
  for (const t of new Set(tokenize(text))) {
    let set = index.get(t);
    if (!set) { set = new Set(); index.set(t, set); }
    set.add(id);
  }
}

/** 全量重建（服务启动时调用一次） */
export function rebuildIndex() {
  index.clear();
  const rows = db.prepare('SELECT id, title, server_name FROM goods').all();
  for (const r of rows) addGoods(r.id, `${r.title} ${r.server_name}`);
  console.log(`[search] 倒排索引重建完成：${rows.length} 条商品，${index.size} 个 term`);
}

/**
 * 倒排检索：query 按空格分组，组内 term 全命中算该组命中
 * 返回 { ids, levelOf }：ids 按命中组数降序；levelOf: Map<goodsId, matchLevel>
 */
export function searchIds(query) {
  const groups = String(query || '').split(/\s+/).filter(Boolean)
    .map(g => [...new Set(tokenize(g))]).filter(g => g.length);
  if (!groups.length) return { ids: [], levelOf: new Map() };

  // 每组命中集合 = 组内各 term 命中集合的交集
  const groupSets = groups.map(terms => {
    let acc = null;
    for (const t of terms) {
      const set = index.get(t);
      if (!set) return new Set();
      acc = acc ? new Set([...acc].filter(id => set.has(id))) : new Set(set);
      if (!acc.size) return acc;
    }
    return acc || new Set();
  });

  const levelOf = new Map();
  for (const gs of groupSets) {
    for (const id of gs) levelOf.set(id, (levelOf.get(id) || 0) + 1);
  }
  const ids = [...levelOf.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { ids, levelOf };
}

// ---------- 拍卖板块：独立倒排索引（规则与商品一致，索引标题） ----------
const auctionIndex = new Map(); // term -> Set<auctionId>

/** 拍卖发布/重建时调用：把 title 的 term 挂到倒排表 */
export function addAuction(id, text) {
  for (const t of new Set(tokenize(text))) {
    let set = auctionIndex.get(t);
    if (!set) { set = new Set(); auctionIndex.set(t, set); }
    set.add(id);
  }
}

/** 拍卖索引全量重建（服务启动时调用一次） */
export function rebuildAuctionIndex() {
  auctionIndex.clear();
  const rows = db.prepare('SELECT id, title FROM auctions').all();
  for (const r of rows) addAuction(r.id, r.title);
  console.log(`[search] 拍卖倒排索引重建完成：${rows.length} 场拍卖，${auctionIndex.size} 个 term`);
}

/**
 * 拍卖倒排检索：query 分词 → 空格分组（组内 bigram/整词，AND 语义），
 * 多个 term（组）同时命中标题的拍卖优先透出
 */
export function searchAuctionIds(query) {
  const groups = String(query || '').split(/\s+/).filter(Boolean)
    .map(g => [...new Set(tokenize(g))]).filter(g => g.length);
  if (!groups.length) return { ids: [], levelOf: new Map() };

  const groupSets = groups.map(terms => {
    let acc = null;
    for (const t of terms) {
      const set = auctionIndex.get(t);
      if (!set) return new Set();
      acc = acc ? new Set([...acc].filter(id => set.has(id))) : new Set(set);
      if (!acc.size) return acc;
    }
    return acc || new Set();
  });

  const levelOf = new Map();
  for (const gs of groupSets) {
    for (const id of gs) levelOf.set(id, (levelOf.get(id) || 0) + 1);
  }
  const ids = [...levelOf.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { ids, levelOf };
}
