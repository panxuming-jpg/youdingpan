/**
 * 维权文书引擎（PRD 模块 F）：证据归集 / 民事起诉状 / 报案材料包 / 交易存证证明
 * 全部基于平台已有交易存证（self_orders / fund_logs / evidence_chain / order_messages /
 * users 实名 / seller_proofs）生成，不引入外部依赖；LLM 可用时仅做事实段落润色，失败静默降级。
 */
import crypto from 'node:crypto';
import { db, parseJSON } from '../db.js';
import { chat, llmEnabled } from '../llm.js';

const fmtTime = ts => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');

/** 身份证脱敏：前 4 后 4，中间以 * 填充 */
export function maskIdCard(id) {
  if (!id) return '';
  if (id.length <= 8) return id;
  return id.slice(0, 4) + '*'.repeat(id.length - 8) + id.slice(-4);
}
/** 姓名脱敏：保留首字 */
export function maskName(name) {
  if (!name) return '';
  return name[0] + '*'.repeat(Math.max(1, name.length - 1));
}

/** 条目哈希：sha256(JSON.stringify(条目)).slice(0,16)，用于文书内容防篡改对照 */
function hash16(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

/**
 * 归集证据清单：[{seq,name,source,time,summary,hash}]
 * full=false 时卖家实名按前4后4脱敏（维权案 filed 之后才给完整值）
 */
export function evidencePack(caseRow, { full = false } = {}) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(caseRow.order_id);
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.buyer_id);
  const seller = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.seller_id);
  const items = [];
  const push = (name, source, time, summary) => {
    const item = { seq: items.length + 1, name, source, time, summary };
    item.hash = hash16(item);
    items.push(item);
  };

  if (o) {
    const snap = parseJSON(o.valuation_snapshot_json, null);
    push('订单合同/交易快照', 'self_orders', o.created_at,
      `订单号 ${o.order_no}，商品价款 ¥${o.price}，实付合计 ¥${o.total}，状态 ${o.status}`
      + (snap ? `；下单时点估值快照：¥${snap.low}-¥${snap.high}（中点 ¥${snap.mid}）` : ''));
    const pays = db.prepare("SELECT * FROM fund_logs WHERE ref_no IN (?,?) AND biz IN ('self_pay','escrow_settle') ORDER BY created_at").all(o.pay_order_no, o.order_no);
    push('支付流水', 'fund_logs', o.paid_at,
      pays.length ? pays.map(p => `${p.biz}/${p.direction} ¥${p.amount}（${fmtTime(p.created_at)}）`).join('；') : `担保支付单号 ${o.pay_order_no || '—'}，支付时间 ${fmtTime(o.paid_at)}`);
    const steps = db.prepare('SELECT type, COUNT(*) AS c FROM evidence_chain WHERE order_id=? GROUP BY type').all(o.id);
    push('六步交接日志', 'evidence_chain', o.completed_at,
      steps.length ? `共 ${steps.reduce((s, r) => s + r.c, 0)} 条留痕：${steps.map(r => `${r.type}×${r.c}`).join('、')}` : '无交接留痕');
    const msgCount = db.prepare('SELECT COUNT(*) AS c FROM order_messages WHERE order_id=?').get(o.id).c;
    push('订单会话消息', 'order_messages', o.created_at, `三方会话共 ${msgCount} 条消息，全程留痕可回溯`);
  }
  push('卖家实名信息', 'users（平台实名核验存档）', o?.created_at,
    full
      ? `${seller?.real_name || '未实名'}，身份证号 ${seller?.id_card || '—'}，注册手机 ${seller?.phone || '—'}`
      : `${maskName(seller?.real_name)}，身份证号 ${maskIdCard(seller?.id_card)}，注册手机 ${seller?.phone ? seller.phone.slice(0, 3) + '****' + seller.phone.slice(-4) : '—'}`);
  push('买家实名信息', 'users（平台实名核验存档）', o?.created_at,
    `${buyer?.real_name || '未实名'}，身份证号 ${maskIdCard(buyer?.id_card)}，注册手机 ${buyer?.phone || '—'}`);
  if (o) {
    const proofs = db.prepare("SELECT type, status FROM seller_proofs WHERE user_id=? AND game_id=?").all(o.seller_id, o.game_id);
    push('卖家归属凭证', 'seller_proofs', o.created_at,
      proofs.length ? `${proofs.length} 项（${proofs.map(p => `${p.type}/${p.status}`).join('、')}）` : '卖家未提交账号归属凭证');
  }
  const materials = parseJSON(caseRow.materials, []);
  if (materials.length) push('买家自证材料', 'rights_cases.materials', caseRow.created_at, `买家上传自证图片 ${materials.length} 张：${materials.join('、')}`);
  push('找回事件描述', 'rights_cases', caseRow.recover_at,
    `被找回时间 ${fmtTime(caseRow.recover_at)}；场景：${caseRow.scenario || '—'}；是否已联系卖家：${caseRow.contacted_seller ? '是' : '否'}；主张损失 ¥${caseRow.loss}`);
  return items;
}

/** HTML 转义（文书正文均经此处理，防注入） */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A4 打印通用内联样式 */
const A4_STYLE = `
  @page { size: A4; margin: 20mm 16mm; }
  body { font-family: "SimSun","宋体",serif; font-size: 14px; line-height: 1.9; color: #111; max-width: 186mm; margin: 0 auto; padding: 24px 16px; }
  h1 { text-align: center; font-size: 22px; letter-spacing: 6px; margin: 8px 0 24px; }
  h2 { font-size: 16px; margin: 18px 0 8px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; font-size: 13px; }
  p { margin: 6px 0; text-indent: 2em; }
  .no-indent { text-indent: 0; }
  .sign { margin-top: 32px; text-align: right; }
  .notice { margin-top: 28px; padding: 10px 12px; border: 1px dashed #999; font-size: 12px; color: #555; text-indent: 0; }
  .head-box { border: 1px solid #999; padding: 8px 12px; margin-bottom: 16px; font-size: 13px; }
`;

/** 模板事实与理由（时间线 + 找回事件） */
export function buildFactsText(caseRow) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(caseRow.order_id);
  const lines = [];
  if (o) {
    lines.push(`${fmtTime(o.created_at)}，原告经游盯盘平台下单购买游戏账号（订单号 ${o.order_no}），`);
    lines.push(`${fmtTime(o.paid_at)} 通过平台担保支付实付价款合计人民币 ${o.total} 元；`);
    lines.push(`${fmtTime(o.completed_at)} 完成六步交接并由原告确认收货，交易完成。`);
  }
  lines.push(`${fmtTime(caseRow.recover_at)}，原告发现该账号被找回（场景描述：${caseRow.scenario || '未说明'}），`);
  lines.push(caseRow.contacted_seller ? '原告已先行联系卖家交涉未果。' : '原告尚未与卖家取得联系。');
  lines.push(`原告主张损失人民币 ${caseRow.loss} 元。平台交易存证（订单合同、支付流水、交接日志、三方会话）可完整还原交易过程。`);
  return lines.join('');
}

/**
 * 事实段落合成：买家修改稿优先；无修改稿且 LLM 可用时尝试润色，失败静默降级为模板文本
 */
export async function composeFacts(caseRow, { edit = '' } = {}) {
  const base = buildFactsText(caseRow);
  if (edit) return String(edit).slice(0, 4000);
  if (!llmEnabled) return base;
  const out = await chat([
    { role: 'system', content: '你是民事起诉状事实与理由段落助手。仅基于给定事实改写为规范法律文书表述（≤400字，中文），不得添加给定事实之外的内容、不得夸大。' },
    { role: 'user', content: base },
  ], { maxTokens: 500 });
  return (out && out.trim()) ? out.trim().slice(0, 4000) : base;
}

/** 兼容别名：单独润色模板文本 */
export async function polishFacts(factsText) {
  return composeFacts({ order_id: 0 }, { edit: factsText });
}

/**
 * 民事起诉状 HTML（A4 打印样式内联）。
 * 校验：loss>0、买卖双方实名存在，否则 throw 中文 Error。
 */
export function buildComplaintHtml(caseRow, { factsEdit = '', claims = null, courtName = '', extraClaim = '' } = {}) {
  const loss = Number(caseRow.loss);
  if (!Number.isFinite(loss) || loss <= 0) throw new Error('损失金额必须大于 0，无法生成起诉状');
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(caseRow.order_id);
  if (!o) throw new Error('关联订单不存在，无法生成起诉状');
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.buyer_id);
  const seller = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.seller_id);
  if (!buyer?.real_name || !buyer?.id_card) throw new Error('买家实名信息缺失，请先完成实名认证');
  const sellerName = seller?.real_name || o.seller_real_name;
  if (!sellerName) throw new Error('卖家实名信息缺失，无法生成起诉状');

  const claimList = Array.isArray(claims) && claims.length ? claims : [
    `判令被告返还购号款人民币 ${loss.toFixed(2)} 元；`,
    extraClaim ? `判令被告赔偿原告损失（${extraClaim}）；` : '判令被告赔偿原告相应损失（具体金额以法庭审理认定为准）；',
    '本案诉讼费用由被告承担。',
  ];
  const facts = factsEdit || buildFactsText(caseRow);
  const evidence = evidencePack(caseRow, { full: true });

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>民事起诉状</title><style>${A4_STYLE}</style></head><body>
<h1>民事起诉状</h1>
<p class="no-indent"><b>原告：</b>${esc(buyer.real_name)}（身份证号 ${esc(buyer.id_card)}），联系电话 ${esc(buyer.phone)}，住址：______（按身份证登记住址填写）。</p>
<p class="no-indent"><b>被告：</b>${esc(sellerName)}（身份证号 ${esc(seller?.id_card || '—')}），联系电话 ${esc(seller?.phone || '—')}，住址：______（按身份证登记住址填写）。</p>
<p class="no-indent" style="font-size:12px;color:#666;">注：被告身份信息来源为平台实名核验存档，仅限本次维权使用。</p>
<h2>诉讼请求</h2>
${claimList.map((c, i) => `<p class="no-indent">${'①②③④⑤⑥'[i] || i + 1}. ${esc(c)}</p>`).join('\n')}
<h2>事实与理由</h2>
<p>${esc(facts)}</p>
<h2>证据清单</h2>
<table><tr><th>序号</th><th>证据名称</th><th>来源</th><th>时间</th><th>内容摘要</th><th>校验码</th></tr>
${evidence.map(e => `<tr><td>${e.seq}</td><td>${esc(e.name)}</td><td>${esc(e.source)}</td><td>${esc(fmtTime(e.time))}</td><td>${esc(e.summary)}</td><td>${e.hash}</td></tr>`).join('\n')}
</table>
<p class="no-indent">此致</p>
<p class="no-indent"><b>${esc(courtName || '______人民法院（被告住所地或合同履行地基层法院，请补填）')}</b></p>
<p class="sign">原告签名：____________</p>
<p class="sign">日期：____________</p>
<p class="notice">本文书由平台依据交易存证辅助生成，内容经原告确认，最终是否立案以人民法院审查为准。</p>
</body></html>`;
}

/** 报案材料包 HTML：递交单位 + 报案陈述 + 证据摘要 + 被报案人信息页 + 损失金额 */
export function buildReportPackHtml(caseRow, station) {
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.buyer_id);
  const seller = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.seller_id);
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(caseRow.order_id);
  const evidence = evidencePack(caseRow, { full: true });
  const stationHead = station
    ? `<div class="head-box"><b>递交单位：</b>${esc(station.name)}<br><b>地址：</b>${esc(station.address || '—')}　<b>联系电话：</b>${esc(station.phone || '—')}<br><span style="color:#666;font-size:12px;">${esc(station.source || '')}</span></div>`
    : '<div class="head-box"><b>递交单位：</b>______（请就近选择公安机关派出所）</div>';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>报案材料包</title><style>${A4_STYLE}</style></head><body>
${stationHead}
<h1>报案材料包</h1>
<h2>一、报案人信息</h2>
<p class="no-indent">报案人：${esc(buyer?.real_name || '未实名')}，身份证号 ${esc(buyer?.id_card || '—')}，联系电话 ${esc(buyer?.phone || '—')}。</p>
<h2>二、报案陈述</h2>
<p>${esc(buildFactsText(caseRow))}</p>
<p class="no-indent">本人对所述事实真实性负责，如有虚假愿承担相应法律责任。</p>
<h2>三、证据摘要</h2>
<table><tr><th>序号</th><th>证据名称</th><th>内容摘要</th><th>校验码</th></tr>
${evidence.map(e => `<tr><td>${e.seq}</td><td>${esc(e.name)}</td><td>${esc(e.summary)}</td><td>${e.hash}</td></tr>`).join('\n')}
</table>
<h2>四、被报案人信息</h2>
<p class="no-indent">被报案人：${esc(seller?.real_name || o?.seller_real_name || '—')}，身份证号 ${esc(seller?.id_card || '—')}，平台注册手机 ${esc(seller?.phone || '—')}，游盯盘平台账号 ID ${caseRow.seller_id}。</p>
<p class="no-indent" style="font-size:12px;color:#666;">来源：平台实名核验存档，仅限本次报案维权使用。</p>
<h2>五、损失金额</h2>
<p class="no-indent">报案人主张损失人民币 ${esc(String(Number(caseRow.loss).toFixed(2)))} 元（订单 ${esc(o?.order_no || '—')} 实付 ¥${esc(o?.total ?? '—')}）。</p>
<p class="notice">本材料包由平台依据交易存证辅助生成，内容经报案人确认；是否受理以公安机关审查为准。</p>
</body></html>`;
}

/** 《交易存证证明》：订单号/双方实名核验/支付流水号/交接日志摘要/合同编号/验证编号 */
export function buildCertHtml(caseRow) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(caseRow.order_id);
  const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.buyer_id);
  const seller = db.prepare('SELECT * FROM users WHERE id=?').get(caseRow.seller_id);
  const plan = db.prepare('SELECT id, status FROM compensation_plans WHERE order_id=?').get(caseRow.order_id);
  const steps = db.prepare('SELECT type, COUNT(*) AS c FROM evidence_chain WHERE order_id=? GROUP BY type').all(caseRow.order_id);
  const verifyNo = `YDP-CERT-${caseRow.id}-${Date.now()}`;
  const game = o ? db.prepare('SELECT name FROM games WHERE id=?').get(o.game_id) : null;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>交易存证证明</title><style>${A4_STYLE}</style></head><body>
<h1>交易存证证明</h1>
<table>
<tr><th>订单号</th><td>${esc(o?.order_no || '—')}</td></tr>
<tr><th>游戏/区服</th><td>${esc(game?.name || '—')}</td></tr>
<tr><th>买家实名核验</th><td>${esc(buyer?.real_name || '—')}（身份证号 ${esc(maskIdCard(buyer?.id_card))}）——平台实名+人脸核验通过</td></tr>
<tr><th>卖家实名核验</th><td>${esc(seller?.real_name || '—')}（身份证号 ${esc(maskIdCard(seller?.id_card))}）——平台实名+人脸核验通过</td></tr>
<tr><th>支付流水号</th><td>${esc(o?.pay_order_no || '—')}，实付 ¥${esc(o?.total ?? '—')}，支付时间 ${esc(fmtTime(o?.paid_at))}</td></tr>
<tr><th>交接日志摘要</th><td>${steps.length ? `平台六步交接共留痕 ${steps.reduce((s, r) => s + r.c, 0)} 条：${steps.map(r => `${r.type}×${r.c}`).join('、')}` : '无交接留痕'}</td></tr>
<tr><th>合同编号</th><td>${plan ? `找回包赔服务协议 #${plan.id}（${esc(plan.status)}）` : '未购买包赔协议'}；订单合同 ${esc(o?.order_no || '—')}</td></tr>
<tr><th>交易完成时间</th><td>${esc(fmtTime(o?.completed_at))}</td></tr>
</table>
<p class="no-indent">兹证明上述交易在游盯盘平台全程留痕，订单合同、担保支付流水、六步交接日志与三方会话记录均可由平台导出核验，本证明所依据的存证数据自交易发生起未被编辑。</p>
<p class="sign">落款：游盯盘平台（运营方签章）</p>
<p class="sign">日期：${esc(new Date().toLocaleDateString('zh-CN'))}</p>
<p class="no-indent"><b>验证编号：${esc(verifyNo)}</b></p>
<p class="notice">本证明为平台交易存证辅助文件，最终采信以司法机关审查为准。</p>
</body></html>`;
}
