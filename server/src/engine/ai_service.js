/**
 * AI 客服全程监管（PRD 4.5 模块 E）
 * - 订单三方会话：买家+卖家+AI；六时点主动播报（支付成功/进入交接/每步节点/超时/报告产出/理赔提交）
 * - 交接步骤校验推进、证据链只追加
 * - 风险监测：站外引导/钓鱼链接/索要凭证话术 → 红条警告 + 风险事件 + 通知运营
 * - 升级人工：转运营工单
 * LLM 不可用时全部走模板兜底。
 */
import { db, parseJSON } from '../db.js';
import { chat, llmEnabled } from '../llm.js';
import { pushToUser } from './sse.js';
import { notify } from './auction.js';

// 交接六步指令模板（FR-A6）
export const HANDOVER_STEPS = [
  null,
  '第 1 步 · 协议与费用确认：请买卖双方核对订单金额、包赔协议签署状态与交接凭证清单。',
  '第 2 步 · 卖家提交账号资料：请卖家在本会话内提交账号登录方式与绑定信息，系统将留时间戳。',
  '第 3 步 · 买家验号：请买家使用卖家提交的资料登录账号，对照商品图组核验资产，并在群内回传验号截图（如需专家核验可加购鉴号服务）。',
  '第 4 步 · 换绑与二次实名：请完成手机/邮箱换绑与游戏内二次实名变更，并在群内回复凭证截图；全部就绪后点击「确认收货」。',
  '第 5 步 · 确认收货：请买家点击「确认收货」；到期未操作将由平台自动确认。',
  '第 6 步 · 平台结算：货款扣除佣金后划入卖家钱包，商品标记已售出，交易完成。',
];

const RISK_RULES = [
  { type: 'offsite', re: /(微信|weixin|wx号|加我|qq|扣扣|站外|私下|线下|脱离平台|自己交易|绕过平台|转账给我|支付宝打款)/i, warn: '请勿引导站外交易或私下收款。所有资金与交接必须在游盯盘订单内完成，站外交易不受平台保障且可能涉嫌诈骗。本条已记入风险事件。' },
  { type: 'phishing', re: /(https?:\/\/[^\s]+)/i, warn: '检测到链接。请仅通过平台官方页面操作，勿点击对方发送的下载链接或登录页面，谨防钓鱼。本条已记入风险事件。' },
  { type: 'credential_ask', re: /(密码发我|验证码.{0,4}(发|给|告诉)|把密码|账号密码给我|发下密码|密码给我)/i, warn: '防诈骗提示：平台客服与交易对方均无需您的密码/验证码，请勿向任何人（含卖家）发送凭证。本条已记入风险事件。' },
];

export function addMessage(orderId, sender, content, meta = null) {
  const now = Date.now();
  db.prepare('INSERT INTO order_messages (order_id, sender, content, meta_json, created_at) VALUES (?,?,?,?,?)')
    .run(orderId, sender, content, meta ? JSON.stringify(meta) : '', now);
  return { id: db.prepare('SELECT MAX(id) AS m FROM order_messages WHERE order_id=?').get(orderId).m, order_id: orderId, sender, content, meta, created_at: now };
}

/** 订单相关方（买家+卖家）SSE 推送 */
function pushOrder(orderId, event, data) {
  const o = db.prepare('SELECT buyer_id, seller_id FROM self_orders WHERE id=?').get(orderId);
  if (!o) return;
  pushToUser(o.buyer_id, event, data);
  pushToUser(o.seller_id, event, data);
}

/** 六时点主动播报 */
export function broadcast(orderId, event, content) {
  const msg = addMessage(orderId, 'ai', content, { event });
  pushOrder(orderId, 'order_msg', { order_id: Number(orderId), event, message: msg });
  return msg;
}

/** 证据链追加（不可编辑） */
export function addEvidence(orderId, type, actor, detail) {
  db.prepare('INSERT INTO evidence_chain (order_id, type, actor, detail_json, created_at) VALUES (?,?,?,?,?)')
    .run(orderId, type, actor, JSON.stringify(detail ?? {}), Date.now());
}

/** 交接步骤推进 + 下发下一步指令 */
export function advanceStep(orderId, step) {
  db.prepare('UPDATE self_orders SET handover_step=?, status=CASE WHEN ?>? THEN status ELSE status END WHERE id=?')
    .run(step, step, 0, orderId);
  const hint = HANDOVER_STEPS[step] || '';
  if (hint) broadcast(orderId, `step_${step}`, hint);
}

/** 升级人工：转运营工单，不中断会话 */
export function escalate(orderId, reason) {
  const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
  for (const a of admins) notify(a.id, 'system', `订单 #${orderId} 转人工`, `原因：${reason}。请查看订单会话与证据链摘要并介入处理。`);
  broadcast(orderId, 'escalated', `已为您转接人工客服（运营工单），请保持会话畅通，平台客服将继续记录交接过程。`);
}

/**
 * 三方群模拟会话（演示）：建群后卖家/买家/客服按交接六步节奏逐条发言，
 * 走现有 SSE 推送（order_msg 事件），meta 标记 {"simulated":1}，前端渲染与真实消息一致。
 * 幂等：该订单已存在 simulated 消息则跳过。setTimeout 链在约 12~60 秒内写完。
 */
const SIM_SCRIPT = [
  ['seller', '在的在的，随时配合，先确认下协议和费用哈'],
  ['buyer', '好的，我这边今晚就能验号'],
  ['ai', '请卖家先提交账号资料截图（区服/资产/实名页），买家收到后在群内回复「开始验号」，全程留痕，谨防私下联系'],
  ['seller', '资料已上传（{game} {server}），请查收'],
  ['buyer', '登录看到了，皮肤数和描述一致'],
  ['ai', '验号无异议的话，我们进入换绑与二次实名环节，请按指引操作并回复凭证'],
  ['ai', '买家确认换绑凭证后可点击「确认收货」，货款 ¥{price} 由平台结算给卖家，全程平台留痕保障'],
];
const SIM_DELAYS_MS = [12_000, 18_000, 25_000, 33_000, 41_000, 49_000, 57_000];

export function simulateChat(orderId) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(orderId);
  if (!o || !['paid', 'handover', 'await_confirm'].includes(o.status)) return;
  const done = db.prepare(`SELECT 1 FROM order_messages WHERE order_id=? AND meta_json LIKE '%"simulated":1%' LIMIT 1`).get(orderId);
  if (done) return; // 幂等：已有模拟群聊记录则跳过
  const l = db.prepare('SELECT server_name FROM listings WHERE id=?').get(o.listing_id);
  const g = db.prepare('SELECT name FROM games WHERE id=?').get(o.game_id);
  const vars = {
    game: g?.name || '该游戏',
    server: l?.server_name || '',
    price: Number(o.price).toFixed(2),
  };
  SIM_SCRIPT.forEach(([sender, tpl], i) => {
    const content = tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    setTimeout(() => {
      // 订单已结束（完成/退款/取消）则不再插入后续模拟消息
      const cur = db.prepare('SELECT status FROM self_orders WHERE id=?').get(orderId);
      if (!cur || ['completed', 'refunded', 'cancelled', 'compensated_closed'].includes(cur.status)) return;
      const msg = addMessage(orderId, sender, content, { simulated: 1 });
      pushOrder(orderId, 'order_msg', { order_id: Number(orderId), event: 'sim', message: msg });
    }, SIM_DELAYS_MS[i]);
  });
}

/** 启动补跑：watch 重启会丢失 setTimeout 链，对交接中且无模拟记录的订单重新排期，保证刷新后总能看到群聊 */
export function backfillSimulatedChats() {
  const orders = db.prepare(`SELECT id FROM self_orders WHERE status IN ('paid','handover','await_confirm')`).all();
  for (const o of orders) simulateChat(o.id);
}

/** 风险检测 + AI 应答。返回 AI 回复消息 */
export async function handleMessage(orderId, sender, content) {
  const o = db.prepare('SELECT * FROM self_orders WHERE id=?').get(orderId);
  if (!o) return null;
  addMessage(orderId, sender, content);
  addEvidence(orderId, 'message', sender, { content: content.slice(0, 500) });

  // 风险监测（FR-E3）
  for (const rule of RISK_RULES) {
    if (rule.re.test(content)) {
      db.prepare('INSERT INTO risk_events (order_id, user_id, type, detail, created_at) VALUES (?,?,?,?,?)')
        .run(orderId, sender === 'buyer' ? o.buyer_id : o.seller_id, rule.type, content.slice(0, 200), Date.now());
      const msg = addMessage(orderId, 'ai', `⚠ 风险提示：${rule.warn}`, { event: 'risk', level: 'danger' });
      pushOrder(orderId, 'order_msg', { order_id: Number(orderId), event: 'risk', message: msg });
      const admins = db.prepare('SELECT id FROM users WHERE is_admin=1').all();
      for (const a of admins) notify(a.id, 'system', '订单风险预警', `订单 #${orderId}（${o.order_no}）会话命中「${rule.type}」风险：${content.slice(0, 80)}`);
      return msg;
    }
  }

  // LLM 应答（带订单上下文）；失败走步骤模板兜底
  let reply = null;
  if (llmEnabled) {
    const l = db.prepare('SELECT server_name, price FROM listings WHERE id=?').get(o.listing_id);
    const out = await chat([
      { role: 'system', content: '你是游盯盘平台订单 AI 客服，负责引导账号交易交接、核验节点、记录留痕与风险预警。你不代任何方执行资金与账号操作、不做纠纷裁决。用中文简洁回复（≤120字），必要时引用交接步骤。' },
      { role: 'user', content: `订单 #${orderId} 状态：${o.status}，当前交接步骤：${o.handover_step}/6，商品区服：${l?.server_name || ''}，价款：¥${o.price}。${sender === 'buyer' ? '买家' : '卖家'}说：${content}` },
    ], { maxTokens: 300 });
    if (out) reply = out.trim().slice(0, 400);
  }
  if (!reply) {
    reply = HANDOVER_STEPS[o.handover_step]
      ? `收到。当前请按流程完成：${HANDOVER_STEPS[o.handover_step]}`
      : '收到，平台客服已记录本条消息至订单证据链。如有疑问可点击「转人工」由运营介入。';
  }
  const msg = addMessage(orderId, 'ai', reply, { event: 'reply' });
  pushOrder(orderId, 'order_msg', { order_id: Number(orderId), event: 'reply', message: msg });
  return msg;
}
