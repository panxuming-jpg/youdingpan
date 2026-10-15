<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { toast } from '../toast.js';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';

const wallet = ref(null);
const logs = ref([]);
const withdraws = ref([]);
const tab = ref('logs'); // logs | withdraws

// 收支类型中文映射（与后端 fundLog 的 biz 对齐）
const BIZ_LABELS = {
  member_pay: '会员支付',
  auction_pay: '拍卖支付',
  escrow_settle: '交易结算',
  refund: '退款',
  withdraw: '提现',
  withdraw_reject: '提现退回',
  deposit_compensate: '保证金赔付',
  member_grant: '后台开通',
  fee: '平台手续费',
};
function bizLabel(b) {
  return BIZ_LABELS[b] || b;
}

const WITHDRAW_STATUS = {
  pending: { label: '审核中', badge: 'badge-warning' },
  paid: { label: '已到账', badge: 'badge-success' },
  rejected: { label: '已驳回', badge: 'badge-danger' },
};

async function load() {
  try {
    wallet.value = await api('/wallet');
  } catch (e) {
    toast.error(e.message);
  }
}
async function loadLogs() {
  try {
    logs.value = await api('/wallet/logs');
  } catch (e) {
    toast.error(e.message);
  }
}
async function loadWithdraws() {
  try {
    withdraws.value = await api('/wallet/withdraws');
  } catch (e) {
    toast.error(e.message);
  }
}

function switchTab(k) {
  tab.value = k;
  if (k === 'logs') loadLogs();
  else loadWithdraws();
}

// ---------- 提现 ----------
const showWithdraw = ref(false);
const submitting = ref(false);
const form = reactive({ amount: '', channel: 'wechat', account: '' });

const amountNum = computed(() => {
  const n = Number(form.amount);
  return Number.isFinite(n) ? n : 0;
});
const feePreview = computed(() => {
  if (!wallet.value || amountNum.value <= 0) return 0;
  const free = wallet.value.withdraw_free_threshold;
  if (free > 0 && amountNum.value >= free) return 0;
  return Math.round(amountNum.value * wallet.value.withdraw_fee_rate * 100) / 100;
});

function openWithdraw() {
  form.amount = '';
  form.channel = 'wechat';
  form.account = '';
  showWithdraw.value = true;
}

async function submitWithdraw() {
  if (amountNum.value <= 0) return toast.error('请输入提现金额');
  if (wallet.value && amountNum.value < wallet.value.withdraw_min) {
    return toast.error(`单笔最低提现金额 ${fmtPrice(wallet.value.withdraw_min)}`);
  }
  if (wallet.value && amountNum.value > wallet.value.balance) return toast.error('提现金额超出可用余额');
  if (!form.account.trim()) return toast.error('请填写收款账户');
  submitting.value = true;
  try {
    await api('/wallet/withdraw', {
      method: 'POST',
      body: { amount: amountNum.value, channel: form.channel, account: form.account.trim() },
    });
    toast.success('提现申请已提交，平台将在 1 个工作日内审核打款');
    showWithdraw.value = false;
    load();
    loadLogs();
    loadWithdraws();
    tab.value = 'withdraws';
  } catch (e) {
    toast.error(e.message);
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  load();
  loadLogs();
  loadWithdraws();
});
</script>

<template>
  <main class="container page">
    <div class="page-title">我的钱包</div>
    <div class="page-sub">拍卖货款结算余额、收支明细与提现</div>

    <div class="stat-grid mb16">
      <div class="card stat-card">
        <div class="stat-value" style="color:var(--success)">{{ wallet ? fmtPrice(wallet.balance) : '-' }}</div>
        <div class="stat-label">可用余额</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{{ wallet ? fmtPrice(wallet.frozen) : '-' }}</div>
        <div class="stat-label">冻结中（出价保证金等）</div>
      </div>
      <div class="card stat-card" style="display:flex; align-items:center; justify-content:center">
        <button class="btn btn-primary" :disabled="!wallet || wallet.balance <= 0" @click="openWithdraw">申请提现</button>
      </div>
    </div>

    <div v-if="wallet" class="muted small mb16" style="line-height:1.7">
      提现规则：单笔最低 {{ fmtPrice(wallet.withdraw_min) }}
      <template v-if="wallet.withdraw_fee_rate > 0">
        · 手续费 {{ (wallet.withdraw_fee_rate * 100).toFixed(1) }}%
        <template v-if="wallet.withdraw_free_threshold > 0">（单笔满 {{ fmtPrice(wallet.withdraw_free_threshold) }} 免手续费）</template>
      </template>
      <template v-else>· 免手续费</template>
      · 提交后平台审核打款（T+1 到账）
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'logs' }" @click="switchTab('logs')">收支明细</button>
      <button class="tab" :class="{ active: tab === 'withdraws' }" @click="switchTab('withdraws')">提现记录</button>
    </div>

    <!-- 收支明细 -->
    <template v-if="tab === 'logs'">
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>时间</th><th>类型</th><th>金额</th><th>渠道</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td class="muted">{{ fmtDateTime(l.created_at) }}</td>
              <td><span class="badge" :class="l.direction === 'in' ? 'badge-success' : ''">{{ bizLabel(l.biz) }}</span></td>
              <td :style="{ color: l.direction === 'in' ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }">
                {{ l.direction === 'in' ? '+' : '-' }}{{ fmtPrice(l.amount) }}
              </td>
              <td class="muted">{{ l.channel === 'wechat' ? '微信' : l.channel === 'alipay' ? '支付宝' : (l.channel || '-') }}</td>
              <td class="muted">{{ l.remark || '-' }}</td>
            </tr>
            <tr v-if="!logs.length">
              <td colspan="5"><EmptyState text="暂无收支记录" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 提现记录 -->
    <template v-else>
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>申请时间</th><th>金额</th><th>手续费</th><th>渠道</th><th>收款账户</th><th>状态</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="w in withdraws" :key="w.id">
              <td class="muted">{{ fmtDateTime(w.created_at) }}</td>
              <td style="font-weight:700">{{ fmtPrice(w.amount) }}</td>
              <td class="muted">{{ fmtPrice(w.fee) }}</td>
              <td>{{ w.channel === 'wechat' ? '微信' : '支付宝' }}</td>
              <td class="muted">{{ w.account }}</td>
              <td><span class="badge" :class="WITHDRAW_STATUS[w.status]?.badge">{{ WITHDRAW_STATUS[w.status]?.label || w.status }}</span></td>
              <td class="muted">{{ w.remark || '-' }}</td>
            </tr>
            <tr v-if="!withdraws.length">
              <td colspan="7"><EmptyState text="暂无提现记录" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 提现申请 -->
    <Modal v-if="showWithdraw" title="申请提现" @close="showWithdraw = false">
      <form @submit.prevent="submitWithdraw">
        <div class="form-item">
          <label class="form-label">提现金额（可用余额 {{ wallet ? fmtPrice(wallet.balance) : '-' }}）<span class="req">*</span></label>
          <input v-model="form.amount" class="input" type="number" min="0" step="0.01" placeholder="请输入提现金额" />
          <div class="form-hint" v-if="feePreview > 0">手续费 {{ fmtPrice(feePreview) }}，实际到账 {{ fmtPrice(amountNum - feePreview) }}</div>
          <div class="form-hint" v-else-if="amountNum > 0">本单免手续费，实际到账 {{ fmtPrice(amountNum) }}</div>
        </div>
        <div class="form-item">
          <label class="form-label">提现渠道<span class="req">*</span></label>
          <div class="row" style="gap:14px">
            <label class="check-row"><input type="radio" value="wechat" v-model="form.channel" /> 微信</label>
            <label class="check-row"><input type="radio" value="alipay" v-model="form.channel" /> 支付宝</label>
          </div>
        </div>
        <div class="form-item">
          <label class="form-label">收款账户<span class="req">*</span></label>
          <input v-model="form.account" class="input" maxlength="60" :placeholder="form.channel === 'wechat' ? '微信号 / 微信绑定手机号' : '支付宝账号（手机号 / 邮箱）'" />
          <div class="form-hint">平台审核通过后，将按此账户打款（模拟环境仅记录，不真实转账）</div>
        </div>
      </form>
      <template #foot>
        <button class="btn btn-ghost" :disabled="submitting" @click="showWithdraw = false">取消</button>
        <button class="btn btn-primary" :disabled="submitting" @click="submitWithdraw">{{ submitting ? '提交中…' : '确认提现' }}</button>
      </template>
    </Modal>
  </main>
</template>
