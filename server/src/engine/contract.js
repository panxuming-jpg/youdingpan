/**
 * 交易电子合同（模拟）：买家担保支付成功即生成《游戏账号交易电子合同》，
 * 买家支付行为视为即时电子签署，卖家在数秒内完成电子签署（模拟），
 * 双方签署后合同即时生效。依据《民法典》第 469 条与《电子签名法》第 3/14 条，
 * 数据电文与可靠电子签名与纸质合同/手写签名具有同等法律效力。
 * 合同内容 SHA-256 哈希存证，签署记录进入订单证据链与三方服务群。
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { maskAccount } from '../pay.js';
import { notify } from './auction.js';
import { broadcast, addEvidence } from './ai_service.js';

function maskId(id) {
  if (!id || id.length < 8) return id || '';
  return id.slice(0, 4) + '**********' + id.slice(-4);
}

/** 合同全文条款（含双方实名与脱敏证件号） */
export function buildContractTerms(o) {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(o.listing_id);
  const g = l ? db.prepare('SELECT name FROM games WHERE id=?').get(l.game_id) : null;
  const b = db.prepare('SELECT real_name, id_card FROM users WHERE id=?').get(o.buyer_id);
  const s = db.prepare('SELECT real_name, id_card FROM users WHERE id=?').get(o.seller_id);
  return {
    title: '游戏账号交易电子合同',
    party_a: { role: '出卖人（卖家）', name: s?.real_name || '', id_mask: maskId(s?.id_card) },
    party_b: { role: '买受人（买家）', name: b?.real_name || '', id_mask: maskId(b?.id_card) },
    subject: `${g?.name || '游戏账号'} · ${l?.server_name || ''} · 账号 ${l ? maskAccount(l.account_id) : ''}`,
    order_no: o.order_no,
    price: o.price,
    legal_basis: '本合同依据《中华人民共和国民法典》第四百六十九条、《中华人民共和国电子签名法》第三条及第十四条以数据电文形式订立，双方可靠电子签名与手写签名或盖章具有同等法律效力，与纸质合同同等有效。',
    terms: [
      '一、标的与权属：甲方保证其对本合同项下游戏账号享有完整、合法的处分权，账号来源合法、无权属争议、无未了结的找回/封禁/盗号记录；如因甲方权属瑕疵导致买家损失，甲方承担全部违约责任。',
      '二、价款与支付：乙方通过平台担保支付向平台托管账户支付商品价款（以订单实付为准），交接完成并经乙方确认收货（或平台自动确认）后由平台结算给甲方；任何一方不得要求站外私下交易。',
      '三、交接义务：双方应在平台三方服务群内按「验号 → 换绑与二次实名 → 确认收货」流程配合完成交接，全程留痕，凭证以订单证据链为准。',
      '四、禁止找回：甲方在交易完成后不得通过申诉、原始凭证、实名认证等手段找回或协助第三方找回已售账号；找回行为构成根本违约，乙方有权依据本合同及平台规则追偿，涉嫌犯罪的移送司法机关。',
      '五、违约责任：任何一方违反本合同约定，应赔偿守约方因此遭受的直接损失（含平台服务费用），并承担平台规则项下的违约金与信用处置。',
      '六、争议解决：因本合同产生的争议，双方同意以平台订单证据链作为事实认定依据；协商不成的，任何一方可向平台经营者所在地有管辖权的人民法院提起诉讼。',
      '七、生效条款：本合同自双方均完成可靠电子签名之时即时生效；合同全文及双方签署时间戳、合同哈希已存证于平台，任何一方均可随时查验。',
    ],
  };
}

/** 支付成功后即时生成合同：买家签署（支付即签），卖家模拟即时签署 */
export function createSaleContract(orderId, paidAt) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(orderId);
  if (!o) return null;
  const existing = db.prepare('SELECT * FROM e_contracts WHERE order_id=?').get(orderId);
  if (existing) return existing; // 幂等：已有合同不重复生成
  const now = paidAt || Date.now();
  const terms = buildContractTerms(o);
  const contractNo = `EC${now.toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const hash = crypto.createHash('sha256').update(JSON.stringify(terms) + contractNo + o.order_no).digest('hex');
  db.prepare(`INSERT INTO e_contracts (order_id, contract_no, buyer_id, seller_id, subject, amount, terms_json, hash,
    buyer_signed_at, status, created_at) VALUES (?,?,?,?,?,?,?, ?,?, 'pending_seller', ?)`)
    .run(orderId, contractNo, o.buyer_id, o.seller_id, terms.subject, o.price, JSON.stringify(terms), hash, now, now);
  addEvidence(orderId, 'sign', 'buyer', { contract_no: contractNo, action: '买家担保支付成功，即时电子签署《游戏账号交易电子合同》', hash });
  broadcast(orderId, 'contract_created',
    `📜 《游戏账号交易电子合同》已生成（合同号 ${contractNo}）。买家支付行为即视为完成电子签署（${new Date(now).toLocaleString('zh-CN')}），正在同步卖家即时签署，双方签署完成后合同即时生效，与纸质合同具有同等法律效力。`);
  notify(o.buyer_id, 'system', '电子合同已签署生效中', `订单 ${o.order_no} 电子合同（${contractNo}）已生成，您已完成签署，等待卖家签署后立即生效。`);
  scheduleSellerSign(orderId);
  return db.prepare('SELECT * FROM e_contracts WHERE order_id=?').get(orderId);
}

/** 卖家即时签署（模拟：数秒后完成；watch 重启丢失定时器时由启动补跑兜底） */
function scheduleSellerSign(orderId, delayMs = 8_000) {
  setTimeout(() => sellerSign(orderId), delayMs);
}

export function sellerSign(orderId) {
  const c = db.prepare(`SELECT * FROM e_contracts WHERE order_id=? AND status='pending_seller'`).get(orderId);
  if (!c) return; // 幂等
  const now = Date.now();
  db.prepare(`UPDATE e_contracts SET seller_signed_at=?, status='signed', signed_at=? WHERE id=?`).run(now, now, c.id);
  addEvidence(orderId, 'sign', 'seller', { contract_no: c.contract_no, action: '卖家完成电子签署，合同生效', hash: c.hash });
  broadcast(orderId, 'contract_signed',
    `✅ 卖家已完成电子签署，《游戏账号交易电子合同》（合同号 ${c.contract_no}）双方签署齐备，合同即时生效。依据《电子签名法》第十四条，可靠电子签名与手写签名或者盖章具有同等法律效力。合同哈希 ${c.hash.slice(0, 16)}… 已存证，可在订单详情随时查验。`);
  const o = db.prepare('SELECT order_no FROM self_orders WHERE id=?').get(orderId);
  notify(c.buyer_id, 'system', '电子合同已生效', `订单 ${o?.order_no || ''} 电子合同（${c.contract_no}）双方签署完成，已即时生效，与纸质合同同等法律效力。`);
  notify(c.seller_id, 'system', '电子合同已生效', `您已签署订单 ${o?.order_no || ''} 电子合同（${c.contract_no}），合同即时生效。请按约定履行交接义务，禁止找回。`);
}

/** 启动补跑：对停留在「待卖家签署」的合同直接补签，保证演示状态最终一致 */
export function backfillPendingContracts() {
  const rows = db.prepare(`SELECT order_id FROM e_contracts WHERE status='pending_seller'`).all();
  for (const r of rows) sellerSign(r.order_id);
}

/** 存量补建：功能上线前已支付的订单按支付时点补建双方已签署合同（不回放群聊播报，仅补合同与证据链） */
export function backfillMissingContracts() {
  const orders = db.prepare(`SELECT o.* FROM self_orders o LEFT JOIN e_contracts c ON c.order_id=o.id
    WHERE o.paid_at IS NOT NULL AND c.id IS NULL`).all();
  for (const o of orders) {
    const terms = buildContractTerms(o);
    const contractNo = `EC${o.paid_at.toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const hash = crypto.createHash('sha256').update(JSON.stringify(terms) + contractNo + o.order_no).digest('hex');
    const sellerSignedAt = o.paid_at + 8_000;
    db.prepare(`INSERT INTO e_contracts (order_id, contract_no, buyer_id, seller_id, subject, amount, terms_json, hash,
      buyer_signed_at, seller_signed_at, status, created_at, signed_at) VALUES (?,?,?,?,?,?,?, ?,?,?, 'signed', ?, ?)`)
      .run(o.id, contractNo, o.buyer_id, o.seller_id, terms.subject, o.price, JSON.stringify(terms), hash, o.paid_at, sellerSignedAt, o.paid_at, sellerSignedAt);
    addEvidence(o.id, 'sign', 'buyer', { contract_no: contractNo, action: '买家担保支付成功，即时电子签署《游戏账号交易电子合同》', hash });
    addEvidence(o.id, 'sign', 'seller', { contract_no: contractNo, action: '卖家完成电子签署，合同生效', hash });
  }
  if (orders.length) console.log(`[contract] 存量补建电子合同 ${orders.length} 份（双方已签署生效）`);
}
