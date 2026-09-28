// 端到端验证：会员限额→支付解锁；拍卖担保全流程（成交→支付→发货→确认→结算→提现→后台审核）；后台各新接口
import { DatabaseSync } from 'node:sqlite';

const API = 'http://localhost:3000/api';
const db = new DatabaseSync(new URL('../data/app.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!d.ok) throw new Error(`${method} ${path} → ${d.error || res.status}`);
  return d.data;
}
async function login(phone) {
  const { code } = await call('/auth/send-code', { method: 'POST', body: { phone } });
  const d = await call('/auth/login', { method: 'POST', body: { phone, code } });
  return d.token;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- A. 免费用户限额 → 会员支付解锁 ----------
console.log('\n[A] 会员限额与支付解锁');
const phoneA = '139' + String(Date.now()).slice(-8);
const tokenA = await login(phoneA);
const goodsList = await call('/goods?size=12');
ok('商品列表返回 ≥11 条', goodsList.list.length >= 11, `got ${goodsList.list.length}`);
const ids = goodsList.list.slice(0, 11).map(g => g.id);

let lockedAt11 = false;
for (let i = 0; i < 10; i++) {
  const g = await call(`/goods/${ids[i]}`, { token: tokenA });
  if (g.locked) { ok(`第 ${i + 1} 个商品不应被锁定`, false); break; }
}
const g11 = await call(`/goods/${ids[10]}`, { token: tokenA });
lockedAt11 = g11.locked === true && g11.price === undefined;
ok('免费用户第 11 个详情被锁定（仅缩略信息）', lockedAt11, JSON.stringify(g11).slice(0, 120));

const ms0 = await call('/member/status', { token: tokenA });
ok('未开通时 is_member=false，view_used=10', ms0.is_member === false && ms0.view_used === 10, JSON.stringify({ m: ms0.is_member, u: ms0.view_used }));

const po = await call('/pay/orders', { method: 'POST', token: tokenA, body: { scene: 'member' } });
ok('创建会员支付单', !!po.order_no && po.amount === 9.9, JSON.stringify(po).slice(0, 100));
await call(`/pay/orders/${po.order_no}/channel`, { method: 'POST', token: tokenA, body: { channel: 'wechat' } });
await call(`/pay/orders/${po.order_no}/confirm`, { method: 'POST', token: tokenA, body: { channel: 'wechat' } });
const poAfter = await call(`/pay/orders/${po.order_no}`, { token: tokenA });
ok('支付单状态 paid', poAfter.status === 'paid', poAfter.status);
const ms1 = await call('/member/status', { token: tokenA });
ok('支付后会员生效且有效期 ~30 天', ms1.is_member === true && ms1.member_expire_at > Date.now() + 29 * 86400000);
const g11b = await call(`/goods/${ids[10]}`, { token: tokenA });
ok('会员查看第 11 个详情解锁', !g11b.locked && g11b.price !== undefined);

// ---------- B. 拍卖担保全流程 ----------
console.log('\n[B] 拍卖担保交易全流程');
const phoneB = '138' + String(Date.now()).slice(-8);
const phoneC = '137' + String(Date.now()).slice(-8);
const tokenB = await login(phoneB); // 卖家
const tokenC = await login(phoneC); // 买家
const meB = await call('/me', { token: tokenB });
const meC = await call('/me', { token: tokenC });

// 直接插库创建 4 秒后结束的拍卖（API 限制最短 12h，测试走库）
const now = Date.now();
const ins = db.prepare(`INSERT INTO auctions (seller_id, game_id, server_id, title, description, images, start_price, increment, reserve_price, deposit_rate, duration, start_at, end_at, status, created_at)
  VALUES (?,1,NULL,'E2E验证拍卖','','[]',100,10,NULL,0.1,12,?,?,'active',?)`).run(meB.id, now, now + 4000, now);
const auctionId = Number(ins.lastInsertRowid);

const bid = await call(`/auctions/${auctionId}/bid`, { method: 'POST', token: tokenC, body: { amount: 100 } });
ok('买家出价成功', bid.current_price === 100 && bid.current_leader_id === meC.id);
const wC0 = await call('/wallet', { token: tokenC });
ok('买家保证金 10 元已冻结', wC0.frozen === 10 && wC0.balance === 9990, JSON.stringify(wC0));

// 出价触发防狙击延时（+5min），测试直接改库到期，等结算引擎 5s 扫描
db.prepare('UPDATE auctions SET end_at=? WHERE id=?').run(Date.now(), auctionId);
await sleep(7000);
const ordersC = await call('/my/orders', { token: tokenC });
const order = ordersC.find(o => o.auction_id === auctionId);
ok('成交生成待支付订单', !!order && order.status === 'pending_payment', JSON.stringify(order?.status));

const po2 = await call(`/orders/${order.id}/pay`, { method: 'POST', token: tokenC });
ok('订单支付创建支付单', !!po2.order_no && po2.amount === 100);
await call(`/pay/orders/${po2.order_no}/channel`, { method: 'POST', token: tokenC, body: { channel: 'alipay' } });
await call(`/pay/orders/${po2.order_no}/confirm`, { method: 'POST', token: tokenC, body: { channel: 'alipay' } });
const soB = await call('/my/sale-orders', { token: tokenB });
const sOrder = soB.find(o => o.id === order.id);
ok('卖家看到待发货订单', sOrder?.status === 'pending_ship', sOrder?.status);

await call(`/orders/${order.id}/ship`, { method: 'POST', token: tokenB, body: { ship_company: '顺丰速运', ship_no: 'SF-E2E-001' } });
const ordersC2 = await call('/my/orders', { token: tokenC });
const cOrder = ordersC2.find(o => o.id === order.id);
ok('买家看到待确认收货+物流+自动确认时间', cOrder?.status === 'pending_confirm' && cOrder.ship_no === 'SF-E2E-001' && cOrder.auto_confirm_at > Date.now());

const wB0 = await call('/wallet', { token: tokenB });
await call(`/orders/${order.id}/confirm`, { method: 'POST', token: tokenC });
const wB1 = await call('/wallet', { token: tokenB });
ok('确认收货后卖家余额 +95（扣 5% 手续费）', Math.round((wB1.balance - wB0.balance) * 100) / 100 === 95, `${wB0.balance}→${wB1.balance}`);

const wd = await call('/wallet/withdraw', { method: 'POST', token: tokenB, body: { amount: 95, channel: 'alipay', account: 'seller@e2e.com' } });
ok('卖家发起提现 95 元', !!wd && (wd.status === 'pending' || wd.id), JSON.stringify(wd).slice(0, 80));

// ---------- C. 后台接口 ----------
console.log('\n[C] 管理后台接口');
const tokenAdmin = await login('13800000000');
const members = await call('/admin/members', { token: tokenAdmin });
ok('会员管理列表含新会员', members.some(u => u.phone === phoneA && u.is_member));
const pays = await call('/admin/pay-orders?status=paid', { token: tokenAdmin });
ok('支付流水含会员单与拍卖单', pays.some(p => p.order_no === po.order_no) && pays.some(p => p.order_no === po2.order_no));
const aos = await call('/admin/auction-orders', { token: tokenAdmin });
ok('担保交易列表含已完成订单', aos.some(o => o.id === order.id && o.status === 'completed'));
const wds = await call('/admin/withdraws?status=pending', { token: tokenAdmin });
const wdRow = wds.find(w => w.user_id === meB.id && w.amount === 95);
ok('提现审核列表有待审核单', !!wdRow);
if (wdRow) {
  await call(`/admin/withdraws/${wdRow.id}/approve`, { method: 'POST', token: tokenAdmin, body: { remark: 'E2E通过' } });
  const wB2 = await call('/wallet', { token: tokenB });
  ok('提现审核通过', true);
  const wdsB = await call('/wallet/withdraws', { token: tokenB });
  ok('卖家提现记录状态 paid', wdsB.some(w => w.id === wdRow.id && w.status === 'paid'), JSON.stringify(wdsB[0]?.status));
  void wB2;
}
const fl = await call('/admin/fund-logs', { token: tokenAdmin });
const bizSet = new Set(fl.map(l => l.biz));
ok('资金流水含结算/手续费/提现', bizSet.has('escrow_settle') && bizSet.has('fee') && bizSet.has('withdraw'), [...bizSet].join(','));
const settings = await call('/admin/settings', { token: tokenAdmin });
ok('系统设置返回配置项', settings.some(s => s.key === 'free_view_limit' && s.value === '10'));

// 清理 E2E 数据（保留后台冒烟数据）
db.prepare('DELETE FROM bids WHERE auction_id=?').run(auctionId);
db.prepare('DELETE FROM auctions WHERE id=?').run(auctionId);
console.log(`\n结果：${pass} 通过，${fail} 失败`);
db.close();
process.exit(fail ? 1 : 0);
