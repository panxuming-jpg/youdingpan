<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { onNotify } from '../sse.js';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const tab = ref('sell'); // sell | buy | orders
const myAuctions = ref([]);
const myBids = ref([]);
const myOrders = ref([]);
const loading = ref(false);

const now = ref(Date.now());
let timer = null;

async function load() {
  loading.value = true;
  try {
    if (tab.value === 'sell') myAuctions.value = await api('/my/auctions');
    else if (tab.value === 'buy') myBids.value = await api('/my/bids');
    else myOrders.value = await api('/my/orders');
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
  return { pending_payment: '待付款', pending_confirm: '待确认收货', completed: '交易完成', cancelled: '已取消' }[s] || s;
}
function orderStatusBadge(s) {
  return { pending_payment: 'badge-warning', pending_confirm: 'badge-primary', completed: 'badge-success', cancelled: 'badge-danger' }[s] || 'badge-primary';
}

async function payOrder(o) {
  if (!confirm(`确认支付 ${fmtPrice(o.amount)} 吗？（模拟付款，资金将进入平台托管）`)) return;
  try {
    await api(`/orders/${o.id}/pay`, { method: 'POST' });
    toast.success('付款成功，等待平台交割');
    load();
  } catch (e) {
    toast.error(e.message);
  }
}

async function confirmOrder(o) {
  if (!confirm('确认已收到账号并核验无误吗？确认后货款将打给卖家。')) return;
  try {
    await api(`/orders/${o.id}/confirm`, { method: 'POST' });
    toast.success('已确认收货，交易完成');
    load();
  } catch (e) {
    toast.error(e.message);
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
    <div class="page-sub">管理我发布的拍卖、参与的竞拍与交易订单</div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'sell' }" @click="switchTab('sell')">我发布的</button>
      <button class="tab" :class="{ active: tab === 'buy' }" @click="switchTab('buy')">我竞拍的</button>
      <button class="tab" :class="{ active: tab === 'orders' }" @click="switchTab('orders')">我的订单</button>
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

    <!-- 我的订单 -->
    <template v-else>
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
              请在 15 分钟内完成付款，逾期将自动取消订单并扣除保证金
            </div>
          </div>
          <div style="text-align:right; flex:none; display:flex; flex-direction:column; gap:8px; align-items:flex-end">
            <div style="font-size:16px; font-weight:700; color:var(--danger)">{{ fmtPrice(o.amount) }}</div>
            <div class="row" style="gap:8px">
              <button v-if="o.status === 'pending_payment'" class="btn btn-primary btn-sm" @click="payOrder(o)">立即付款</button>
              <button v-if="o.status === 'pending_confirm'" class="btn btn-primary btn-sm" @click="confirmOrder(o)">确认收货</button>
              <button class="btn btn-ghost btn-sm" @click="router.push(`/auctions/${o.auction_id}`)">查看拍卖</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="暂无拍卖订单" icon="📦" />
      </div>
    </template>
  </main>
</template>
