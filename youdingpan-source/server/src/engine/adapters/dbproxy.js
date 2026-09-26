// 桥接模块：让 adapters/base.js 复用 db.js 的连接（避免循环依赖问题集中在此）
import { db } from '../../db.js';

export function dbPrepare(sql) {
  return db.prepare(sql);
}
