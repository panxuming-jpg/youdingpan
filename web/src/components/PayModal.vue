<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { api } from '../api.js';
import { fmtPrice } from '../utils.js';
import { toast } from '../toast.js';
import Modal from './Modal.vue';

// 统一收银台：会员订阅 / 拍卖担保支付共用
// 当前为模拟支付环境：选择渠道后点击支付即视为支付成功（真实 SDK 接入点见 server/src/pay.js）
const props = defineProps({
  payOrder: { type: Object, required: true }, // { order_no, subject, amount, expire_at, status }
});
const emit = defineEmits(['close', 'success']);

const CHANNELS = [
  { key: 'wechat', label: '微信支付', desc: '推荐使用', cls: 'pay-channel-wechat' },
  { key: 'alipay', label: '支付宝', desc: '支付宝 App 支付', cls: 'pay-channel-alipay' },
];

const channel = ref('wechat');
const paying = ref(false);
const paid = ref(false);
const now = ref(Date.now());

const remainMs = computed(() => Math.max(0, (props.payOrder.expire_at || 0) - now.value));
const expired = computed(() => remainMs.value <= 0 && !paid.value);
const countdown = computed(() => {
  const m = Math.floor(remainMs.value / 60000);
  const s = Math.floor((remainMs.value % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});

const tick = setInterval(() => { now.value = Date.now(); }, 1000);

let polling = null;
function startPolling() {
  // 轮询支付单状态直至支付成功（真实环境下等待支付平台异步回调）
  polling = setInterval(async () => {
    try {
      const o = await api(`/pay/orders/${props.payOrder.order_no}`);
      if (o.status === 'paid') {
        stopPolling();
        paid.value = true;
        toast.success('支付成功');
        setTimeout(() => emit('success'), 600);
      }
    } catch { /* 轮询失败静默，下一轮重试 */ }
  }, 1200);
}
function stopPolling() {
  if (polling) { clearInterval(polling); polling = null; }
}

async function pay() {
  if (paying.value || expired.value) return;
  paying.value = true;
  try {
    // 1. 选择渠道获取支付参数（模拟通道直接返回可确认信息）
    await api(`/pay/orders/${props.payOrder.order_no}/channel`, { method: 'POST', body: { channel: channel.value } });
    // 2. 模拟支付成功确认（真实环境下此步骤由用户在收银台完成后，支付平台回调触发）
    await api(`/pay/orders/${props.payOrder.order_no}/confirm`, { method: 'POST', body: { channel: channel.value } });
    // 3. 轮询确认到账（幂等）
    startPolling();
  } catch (e) {
    toast.error(e.message);
    paying.value = false;
  }
}

onUnmounted(() => {
  clearInterval(tick);
  stopPolling();
});
</script>

<template>
  <Modal title="收银台" @close="!paying && emit('close')">
    <div class="pay-subject">{{ payOrder.subject }}</div>
    <div class="pay-amount">{{ fmtPrice(payOrder.amount) }}</div>
    <div class="muted small" style="text-align:center">
      订单号 {{ payOrder.order_no }}
      <span v-if="!expired && !paid"> · 请在 <b style="color:var(--danger)">{{ countdown }}</b> 内完成支付</span>
      <span v-else-if="expired" style="color:var(--danger)"> · 订单已超时，请关闭后重新下单</span>
    </div>

    <template v-if="!expired && !paid">
      <div class="form-label" style="margin-top:18px">选择支付方式</div>
      <div class="pay-channels">
        <button
          v-for="c in CHANNELS"
          :key="c.key"
          class="pay-channel"
          :class="[c.cls, { active: channel === c.key }]"
          type="button"
          :disabled="paying"
          @click="channel = c.key"
        >
          <span class="pay-channel-name">{{ c.label }}</span>
          <span class="pay-channel-desc">{{ c.desc }}</span>
        </button>
      </div>
      <p class="form-hint" style="margin-top:10px">
        当前为模拟支付环境，点击「立即支付」即视为支付成功；接入真实微信/支付宝 SDK 后将跳转官方收银台。
      </p>
    </template>

    <div v-if="paid" class="pay-paid">
      <div class="pay-paid-icon">✓</div>
      <div style="font-weight:700">支付成功</div>
      <div class="muted small">正在为您开通权益 / 更新订单状态…</div>
    </div>

    <template #foot>
      <button v-if="!paid" class="btn btn-ghost" :disabled="paying" @click="emit('close')">{{ expired ? '关闭' : '取消' }}</button>
      <button
        v-if="!expired && !paid"
        class="btn btn-primary"
        :disabled="paying"
        @click="pay"
      >{{ paying ? '支付中…' : `立即支付 ${fmtPrice(payOrder.amount)}` }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.pay-subject { text-align: center; font-size: 14px; color: var(--text2); }
.pay-amount { text-align: center; font-size: 30px; font-weight: 800; margin: 8px 0 6px; }
.pay-channels { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.pay-channel {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border: 1px solid var(--border-strong, #d9dce3); border-radius: 10px;
  background: #fff; cursor: pointer; font-size: 14px; text-align: left;
}
.pay-channel:disabled { opacity: 0.6; cursor: not-allowed; }
.pay-channel.active { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12); }
.pay-channel-name { font-weight: 700; }
.pay-channel-wechat .pay-channel-name { color: #09bb07; }
.pay-channel-alipay .pay-channel-name { color: #1677ff; }
.pay-channel-desc { font-size: 12px; color: var(--text2); }
.pay-paid { text-align: center; padding: 18px 0 6px; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.pay-paid-icon {
  width: 44px; height: 44px; border-radius: 50%; background: var(--success); color: #fff;
  font-size: 24px; line-height: 44px; text-align: center;
}
</style>
