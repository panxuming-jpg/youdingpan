<script setup>
// 卖家侧拍卖列表：内嵌于卖家中心「拍卖商品」区块，含两个子 tab。
// 「我发布的」GET /my/auctions（进行中且无出价可撤销，沿用 POST /auctions/:id/cancel）；
// 「我售出的」GET /my/sale-orders（端点与渲染沿用 MyAuctions.vue 卖家订单逻辑）。
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { toast } from '../toast.js';
import { onNotify } from '../sse.js';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';

const router = useRouter();

const subtab = ref('mine'); // mine 我发布的 | sold 我售出的
const myAuctions = ref([]);
const mySaleOrders = ref([]);
const loading = ref(false);

const now = ref(Date.now());
let timer = null;

// 发货弹窗
const shipOrder = ref(null);
const shipForm = ref({ ship_company: '', ship_no: '' });
const shipping = ref(false);

async function load() {
  loading.value = true;
  try {
    if (subtab.value === 'mine') myAuctions.value = await api('/my/auctions');
    else mySaleOrders.value = await api('/my/sale-orders');
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

function switchSub(k) {
  subtab.value = k;
  load();
}

// 供父组件在发布成功后调用：切到「我发布的」并刷新
function goMine() {
  subtab.value = 'mine';
  load();
}
defineExpose({ goMine });

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

// 撤销进行中的拍卖（无出价时可撤销，沿用现有端点）
async function cancelAuction(a) {
  if (!confirm('确定取消该拍卖吗？')) return;
  try {
    await api(`/auctions/${a.id}/cancel`, { method: 'POST' });
    toast.success('已取消');
    load();
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 卖家发货动作 ----------
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
  <div>
    <div class="tabs">
      <button class="tab" :class="{ active: subtab === 'mine' }" @click="switchSub('mine')">我发布的</button>
      <button class="tab" :class="{ active: subtab === 'sold' }" @click="switchSub('sold')">我售出的</button>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <!-- 我发布的 -->
    <template v-else-if="subtab === 'mine'">
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
            <button
              v-if="a.status === 'active' && a.bid_count === 0"
              class="btn btn-danger-ghost btn-sm"
              style="margin-top:6px"
              @click.stop="cancelAuction(a)"
            >取消拍卖</button>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="还没有发布拍卖，点击上方「＋ 发布拍卖」开始吧" icon="🔨" />
      </div>
    </template>

    <!-- 我售出的（拍卖成交订单） -->
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
  </div>
</template>
