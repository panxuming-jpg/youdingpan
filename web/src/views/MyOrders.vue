<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { onNotify } from '../sse.js';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const role = ref('buy'); // buy 我买到的 | sell 我卖出的
const orders = ref([]);
const loading = ref(false);

const STATUS_MAP = {
  pending_payment: { label: '待支付', badge: 'badge-warning', hint: '请在支付时限内完成担保支付，逾期自动取消' },
  paid: { label: '已支付', badge: 'badge-primary', hint: '资金由平台担保，等待开始交接' },
  handover: { label: '交接中', badge: 'badge-primary', hint: '买卖双方正在平台监督下交接账号' },
  await_confirm: { label: '待确认收货', badge: 'badge-primary', hint: '买家核验资产后确认收货，逾期未操作将自动确认结算' },
  completed: { label: '交易完成', badge: 'badge-success', hint: '货款已结算，交易完成' },
  cancelled: { label: '已取消', badge: 'badge', hint: '订单已取消' },
  refunding: { label: '退款处理中', badge: 'badge-warning', hint: '退款申请处理中，卖家可在 48 小时内申诉' },
  seller_appealed: { label: '申诉待裁决', badge: 'badge-warning', hint: '卖家已申诉，等待运营依据证据链裁决' },
  refunded: { label: '已退款', badge: 'badge-danger', hint: '已全额退款，资金原路退回' },
  compensated_closed: { label: '包赔关闭', badge: 'badge-danger', hint: '平台已按包赔协议赔付关单' },
};

const STEP_SHORT = ['', '协议确认', '卖家资料', '改密换绑', '核验资产', '确认收货', '平台结算'];

function statusLabel(s) { return STATUS_MAP[s]?.label || s; }
function statusBadge(s) { return STATUS_MAP[s]?.badge || 'badge'; }
function statusHint(s) { return STATUS_MAP[s]?.hint || ''; }

function showProgress(o) {
  return o.handover_step > 0 && !['pending_payment', 'cancelled'].includes(o.status);
}

async function load() {
  loading.value = true;
  try {
    orders.value = await api('/orders/mine', { query: { role: role.value } });
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

function switchRole(k) {
  if (role.value === k) return;
  role.value = k;
  load();
}

onMounted(() => {
  if (!store.token) {
    router.push({ path: '/login', query: { redirect: '/orders' } });
    return;
  }
  load();
});

const offNotify = onNotify(() => load());
onUnmounted(() => offNotify());
</script>

<template>
  <main class="container page">
    <div class="page-title">我的订单</div>
    <div class="page-sub">自营担保交易订单：下单即托管支付，六步交接全程留痕，确认收货后平台结算</div>

    <div class="tabs">
      <button class="tab" :class="{ active: role === 'buy' }" @click="switchRole('buy')">我买到的</button>
      <button class="tab" :class="{ active: role === 'sell' }" @click="switchRole('sell')">我卖出的</button>
    </div>

    <div v-if="loading && !orders.length" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="orders.length" class="card" style="overflow:hidden">
      <div
        v-for="o in orders"
        :key="o.id"
        class="msg-item"
        style="cursor:pointer"
        @click="router.push(`/orders/${o.id}`)"
      >
        <div style="flex:1; min-width:0">
          <div class="row wrap" style="gap:8px">
            <span class="badge" :class="statusBadge(o.status)">{{ statusLabel(o.status) }}</span>
            <b style="font-size:14px">{{ o.game_name }} · {{ o.server_name }}</b>
            <span class="muted small">{{ o.order_no }}</span>
          </div>
          <div class="muted small" style="margin-top:4px">
            账号：{{ o.account_mask }}
            · 下单 {{ fmtDateTime(o.created_at) }}
            <template v-if="o.paid_at"> · 支付 {{ fmtDateTime(o.paid_at) }}</template>
            <template v-if="o.completed_at"> · 完成 {{ fmtDateTime(o.completed_at) }}</template>
          </div>
          <div class="muted small" style="margin-top:2px">
            商品 {{ fmtPrice(o.price) }}
            <template v-if="o.compensation_fee > 0"> + 包赔服务费 {{ fmtPrice(o.compensation_fee) }}</template>
            <template v-if="o.appraisal_fee > 0"> + 鉴号服务费 {{ fmtPrice(o.appraisal_fee) }}</template>
          </div>
          <div v-if="o.refund_reason" class="small mt8" style="color:var(--warning)">退款原因：{{ o.refund_reason }}</div>
          <div v-else-if="statusHint(o.status)" class="muted small mt8">{{ statusHint(o.status) }}</div>

          <!-- 交接步骤进度（1-6） -->
          <div v-if="showProgress(o)" class="row wrap mt8" style="gap:4px">
            <template v-for="i in 6" :key="i">
              <span
                class="badge"
                :class="i < o.handover_step || o.status === 'completed' ? 'badge-success' : (i === o.handover_step ? 'badge-primary' : '')"
                style="font-size:11px"
              >{{ i }}.{{ STEP_SHORT[i] }}</span>
              <span v-if="i < 6" class="muted" style="font-size:10px">›</span>
            </template>
          </div>
        </div>
        <div style="text-align:right; flex:none">
          <div style="font-size:16px; font-weight:700; color:var(--danger)">{{ fmtPrice(o.total) }}</div>
          <div class="muted small" style="margin-top:4px">查看详情 →</div>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <EmptyState
        :text="role === 'buy' ? '还没有买到的自营订单，去自营市场逛逛吧' : '还没有卖出的订单，在卖家中心发布账号商品吧'"
        icon="📦"
      >
        <button class="btn btn-primary" @click="router.push(role === 'buy' ? '/self' : '/seller')">
          {{ role === 'buy' ? '逛自营市场' : '去卖家中心' }}
        </button>
      </EmptyState>
    </div>
  </main>
</template>
