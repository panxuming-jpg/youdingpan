<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { onNotify } from '../sse.js';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';
import PayModal from '../components/PayModal.vue';

const router = useRouter();

const tab = ref('sell'); // sell | buy | orders | sale
const myAuctions = ref([]);
const myBids = ref([]);
const myOrders = ref([]);
const mySaleOrders = ref([]);
const loading = ref(false);

const now = ref(Date.now());
let timer = null;

// 支付收银台
const payOrderInfo = ref(null);
// 发货弹窗
const shipOrder = ref(null);
const shipForm = ref({ ship_company: '', ship_no: '' });
const shipping = ref(false);
// 售后申诉弹窗
const afterSaleOrder = ref(null);
const afterSaleReason = ref('');
const afterSaleSubmitting = ref(false);

async function load() {
  loading.value = true;
  try {
    if (tab.value === 'sell') myAuctions.value = await api('/my/auctions');
    else if (tab.value === 'buy') myBids.value = await api('/my/bids');
    else if (tab.value === 'orders') myOrders.value = await api('/my/orders');
    else mySaleOrders.value = await api('/my/sale-orders');
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

function switchTab(k) {
  tab.value = k;
  load();
}

function countdown(a) {
  if (a.status !== 'active') return '已结束';
  const remain = a.end_at - now.value;
  if (remain <= 0) return '已结束';
  const h = Math.floor(remain / 3600000);
  const m = Math.floor((remain % 3600000) / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  return h > 0 ? `${h}时${m}分${s}秒` : `${m}分${s}秒`;
}

function statusLabel(s) {
  return { active: '拍卖中', sold: '已成交', failed: '已流拍', cancelled: '已取消', completed: '已完成' }[s] || s;
}
function statusBadge(s) {
  return { active: 'badge-success', sold: 'badge-primary', failed: 'badge-warning', cancelled: 'badge-danger', completed: 'badge-primary' }[s] || 'badge-primary';
}

function orderStatusLabel(s) {
  return {
    pending_payment: '待支付',
    pending_ship: '待发货',
    pending_confirm: '待确认收货',
    completed: '交易完成',
    cancelled: '已关闭',
    refunded: '已退款',
    after_sale: '售后中',
  }[s] || s;
}
function orderStatusBadge(s) {
  return {
    pending_payment: 'badge-warning',
    pending_ship: 'badge-primary',
    pending_confirm: 'badge-primary',
    completed: 'badge-success',
    cancelled: 'badge-danger',
    refunded: 'badge-danger',
    after_sale: 'badge-warning',
  }[s] || 'badge-primary';
}

// ---------- 买家动作 ----------
async function payOrder(o) {
  try {
    const po = await api(`/orders/${o.id}/pay`, { method: 'POST' });
    payOrderInfo.value = po;
  } catch (e) {
    toast.error(e.message);
  }
}

function onPaySuccess() {
  payOrderInfo.value = null;
  toast.success('支付成功，资金已进入平台担保账户');
  load();
}

async function refundOrder(o) {
  if (!confirm(`确认申请退款 ${fmtPrice(o.amount)} 吗？卖家未发货，退款将原路退回。`)) return;
  try {
    await api(`/orders/${o.id}/refund`, { method: 'POST' });
    toast.success('退款成功，资金已原路退回');
    load();
  } catch (e) {
    toast.error(e.message);
  }
}

async function confirmOrder(o) {
  if (!confirm('确认已收到账号并核验无误吗？确认后担保资金将结算给卖家。')) return;
  try {
    await api(`/orders/${o.id}/confirm`, { method: 'POST' });
    toast.success('已确认收货，交易完成');
    load();
  } catch (e) {
    toast.error(e.message);
  }
}

function openAfterSale(o) {
  afterSaleOrder.value = o;
  afterSaleReason.value = '';
}

async function submitAfterSale() {
  if (!afterSaleReason.value.trim()) return toast.error('请填写售后申诉原因');
  afterSaleSubmitting.value = true;
  try {
    await api(`/orders/${afterSaleOrder.value.id}/after-sale`, {
      method: 'POST',
      body: { reason: afterSaleReason.value.trim() },
    });
    toast.success('售后申诉已提交，平台将介入仲裁');
    afterSaleOrder.value = null;
    load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    afterSaleSubmitting.value = false;
  }
}

// ---------- 卖家动作 ----------
function openShip(o) {
  shipOrder.value = o;
  shipForm.value = { ship_company: '', ship_no: '' };
}

async function submitShip() {
  if (!shipForm.value.ship_company.trim()) return toast.error('请填写物流公司');
  if (!shipForm.value.ship_no.trim()) return toast.error('请填写物流单号');
  shipping.value = true;
  try {
    await api(`/orders/${shipOrder.value.id}/ship`, { method: 'POST', body: shipForm.value });
    toast.success('已发货，等待买家确认收货');
    shipOrder.value = null;
    load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    shipping.value = false;
  }
}

const offNotify = onNotify(() => load());
onMounted(() => {
  load();
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  offNotify();
});
</script>

<template>
  <main class="container page">
    <div class="page-title">我的拍卖</div>
    <div class="page-sub">管理我发布的拍卖、参与的竞拍与担保交易订单</div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'sell' }" @click="switchTab('sell')">我发布的</button>
      <button class="tab" :class="{ active: tab === 'buy' }" @click="switchTab('buy')">我竞拍的</button>
      <button class="tab" :class="{ active: tab === 'orders' }" @click="switchTab('orders')">我买到的</button>
      <button class="tab" :class="{ active: tab === 'sale' }" @click="switchTab('sale')">我售出的</button>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <!-- 我发布的 -->
    <template v-else-if="tab === 'sell'">
      <div v-if="myAuctions.length" class="card" style="overflow:hidden">
        <div v-for="a in myAuctions" :key="a.id" class="msg-item" style="cursor:pointer" @click="router.push(`/auctions/${a.id}`)">
          <div style="flex:1; min-width:0">
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <span class="badge" :class="statusBadge(a.status)">{{ statusLabel(a.status) }}</span>
              <b style="font-size:14px">{{ a.title }}</b>
            </div>
            <div class="muted small" style="margin-top:4px">
              {{ a.game_name }}<span v-if="a.server_name"> · {{ a.server_name }}</span>
              · 起拍 {{ fmtPrice(a.start_price) }} · 加价 {{ fmtPrice(a.increment) }}
              · {{ a.bid_count }} 次出价
              <span v-if="a.current_price"> · 当前 {{ fmtPrice(a.current_price) }}</span>
            </div>
          </div>
          <div style="text-align:right; flex:none">
            <div class="muted small">{{ countdown(a) }}</div>
            <div class="muted small" style="margin-top:4px">{{ fmtDateTime(a.created_at) }}</div>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="还没有发布拍卖，点击右上角「发布拍卖」开始吧" icon="🔨" />
      </div>
    </template>

    <!-- 我竞拍的 -->
    <template v-else-if="tab === 'buy'">
      <div v-if="myBids.length" class="card" style="overflow:hidden">
        <div v-for="a in myBids" :key="a.id" class="msg-item" style="cursor:pointer" @click="router.push(`/auctions/${a.id}`)">
          <div style="flex:1; min-width:0">
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <span class="badge" :class="statusBadge(a.status)">{{ statusLabel(a.status) }}</span>
              <span v-if="store.user && a.current_leader_id === store.user.id" class="badge badge-success">领先</span>
              <b style="font-size:14px">{{ a.title }}</b>
            </div>
            <div class="muted small" style="margin-top:4px">
              {{ a.game_name }}<span v-if="a.server_name"> · {{ a.server_name }}</span>
              · 当前价 {{ a.current_price ? fmtPrice(a.current_price) : fmtPrice(a.start_price) }}
              · {{ a.bid_count }} 次出价
            </div>
          </div>
          <div style="text-align:right; flex:none">
            <div class="muted small">{{ countdown(a) }}</div>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="还没有参与任何竞拍，去拍卖市场看看吧" icon="🔨" />
      </div>
    </template>

    <!-- 我买到的（买家订单） -->
    <template v-else-if="tab === 'orders'">
      <div v-if="myOrders.length" class="card" style="overflow:hidden">
        <div v-for="o in myOrders" :key="o.id" class="msg-item">
          <div style="flex:1; min-width:0">
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <span class="badge" :class="orderStatusBadge(o.status)">{{ orderStatusLabel(o.status) }}</span>
              <b style="font-size:14px">{{ o.auction_title }}</b>
            </div>
            <div class="muted small" style="margin-top:4px">
              卖家：{{ o.seller_name }} · 成交价 {{ fmtPrice(o.amount) }} · 下单时间 {{ fmtDateTime(o.created_at) }}
            </div>
            <div v-if="o.status === 'pending_payment'" class="small" style="color:var(--danger); margin-top:4px">
              请在 15 分钟内完成支付，逾期订单自动取消，拍卖流拍
            </div>
            <div v-else-if="o.status === 'pending_ship'" class="muted small" style="margin-top:4px">
              支付成功，资金由平台担保 · 等待卖家发货
            </div>
            <div v-else-if="o.status === 'pending_confirm'" class="muted small" style="margin-top:4px">
              物流：{{ o.ship_company }} {{ o.ship_no }} · 发货于 {{ fmtDateTime(o.shipped_at) }}
              <template v-if="o.auto_confirm_at">
                <br />{{ fmtDateTime(o.auto_confirm_at) }} 前未确认将自动确认收货
              </template>
            </div>
            <div v-else-if="o.status === 'after_sale'" class="small" style="color:var(--warning); margin-top:4px">
              售后申诉处理中：{{ o.after_sale_reason }} · 担保资金已冻结，平台仲裁后结算/退款
            </div>
            <div v-else-if="o.status === 'completed'" class="muted small" style="margin-top:4px">
              交易完成 · 担保资金已结算给卖家
            </div>
            <div v-else-if="o.status === 'refunded'" class="muted small" style="margin-top:4px">
              已退款 · {{ fmtDateTime(o.refunded_at) }}
            </div>
          </div>
          <div style="text-align:right; flex:none; display:flex; flex-direction:column; gap:8px; align-items:flex-end">
            <div style="font-size:16px; font-weight:700; color:var(--danger)">{{ fmtPrice(o.amount) }}</div>
            <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
              <button v-if="o.status === 'pending_payment'" class="btn btn-primary btn-sm" @click="payOrder(o)">立即支付</button>
              <button v-if="o.status === 'pending_ship'" class="btn btn-danger-ghost btn-sm" @click="refundOrder(o)">申请退款</button>
              <button v-if="o.status === 'pending_confirm'" class="btn btn-primary btn-sm" @click="confirmOrder(o)">确认收货</button>
              <button v-if="o.status === 'pending_confirm'" class="btn btn-ghost btn-sm" @click="openAfterSale(o)">售后申诉</button>
              <button class="btn btn-ghost btn-sm" @click="router.push(`/auctions/${o.auction_id}`)">查看拍卖</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="暂无买入订单" icon="📦" />
      </div>
    </template>

    <!-- 我售出的（卖家订单） -->
    <template v-else>
      <div v-if="mySaleOrders.length" class="card" style="overflow:hidden">
        <div v-for="o in mySaleOrders" :key="o.id" class="msg-item">
          <div style="flex:1; min-width:0">
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <span class="badge" :class="orderStatusBadge(o.status)">{{ orderStatusLabel(o.status) }}</span>
              <b style="font-size:14px">{{ o.auction_title }}</b>
            </div>
            <div class="muted small" style="margin-top:4px">
              买家：{{ o.buyer_name }} · 成交价 {{ fmtPrice(o.amount) }} · 下单时间 {{ fmtDateTime(o.created_at) }}
            </div>
            <div v-if="o.status === 'pending_payment'" class="muted small" style="margin-top:4px">
              等待买家支付（15 分钟未支付订单自动关闭）
            </div>
            <div v-else-if="o.status === 'pending_ship'" class="small" style="color:var(--primary); margin-top:4px">
              买家已付款，资金由平台担保 · 请尽快填写物流发货
            </div>
            <div v-else-if="o.status === 'pending_confirm'" class="muted small" style="margin-top:4px">
              物流：{{ o.ship_company }} {{ o.ship_no }} · 等待买家确认收货
              <template v-if="o.auto_confirm_at">
                <br />{{ fmtDateTime(o.auto_confirm_at) }} 后系统自动确认，资金结算至您的余额
              </template>
            </div>
            <div v-else-if="o.status === 'after_sale'" class="small" style="color:var(--warning); margin-top:4px">
              买家发起售后申诉：{{ o.after_sale_reason }} · 担保资金已冻结，等待平台仲裁
            </div>
            <div v-else-if="o.status === 'completed'" class="muted small" style="margin-top:4px">
              交易完成 · 货款已结算至您的平台余额（已扣除平台服务费）
            </div>
            <div v-else-if="o.status === 'refunded'" class="muted small" style="margin-top:4px">
              已退款给买家 · {{ fmtDateTime(o.refunded_at) }}
            </div>
          </div>
          <div style="text-align:right; flex:none; display:flex; flex-direction:column; gap:8px; align-items:flex-end">
            <div style="font-size:16px; font-weight:700; color:var(--danger)">{{ fmtPrice(o.amount) }}</div>
            <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
              <button v-if="o.status === 'pending_ship'" class="btn btn-primary btn-sm" @click="openShip(o)">填写物流发货</button>
              <button class="btn btn-ghost btn-sm" @click="router.push(`/auctions/${o.auction_id}`)">查看拍卖</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="暂无售出订单" icon="📦" />
      </div>
    </template>

    <!-- 收银台 -->
    <PayModal
      v-if="payOrderInfo"
      :pay-order="payOrderInfo"
      @close="payOrderInfo = null"
      @success="onPaySuccess"
    />

    <!-- 发货弹窗 -->
    <Modal v-if="shipOrder" title="填写物流发货" @close="shipOrder = null">
      <div class="form-item">
        <div class="form-label">物流公司</div>
        <input v-model="shipForm.ship_company" class="input" placeholder="如：顺丰速运 / 账号交割可填「线上交割」" />
      </div>
      <div class="form-item">
        <div class="form-label">物流单号</div>
        <input v-model="shipForm.ship_no" class="input" placeholder="请输入物流/交割单号" />
      </div>
      <p class="form-hint">发货后买家有 7 天确认期，逾期系统自动确认收货，担保资金结算至您的余额。</p>
      <template #foot>
        <button class="btn btn-ghost" :disabled="shipping" @click="shipOrder = null">取消</button>
        <button class="btn btn-primary" :disabled="shipping" @click="submitShip">{{ shipping ? '提交中…' : '确认发货' }}</button>
      </template>
    </Modal>

    <!-- 售后申诉弹窗 -->
    <Modal v-if="afterSaleOrder" title="售后申诉" @close="afterSaleOrder = null">
      <div class="form-item">
        <div class="form-label">申诉原因</div>
        <textarea
          v-model="afterSaleReason"
          class="input"
          rows="4"
          placeholder="请描述问题，如：卖家虚假发货、账号与描述不符等"
        ></textarea>
      </div>
      <p class="form-hint">提交后平台将介入仲裁，期间担保资金冻结，仲裁完成后结算给卖家或退款给您。</p>
      <template #foot>
        <button class="btn btn-ghost" :disabled="afterSaleSubmitting" @click="afterSaleOrder = null">取消</button>
        <button class="btn btn-primary" :disabled="afterSaleSubmitting" @click="submitAfterSale">{{ afterSaleSubmitting ? '提交中…' : '提交申诉' }}</button>
      </template>
    </Modal>
  </main>
</template>
