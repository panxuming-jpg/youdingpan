<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { fmtPrice, fmtDateTime, rightsStatus, claimTypeLabel } from '../utils.js';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const cases = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    cases.value = await api('/rights/mine');
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="container page">
    <div class="page-title">追账号维权</div>
    <div class="page-sub">已完成的担保订单账号被找回？平台依据交易存证核验证据，协助生成民事起诉状与报案材料包，并冻结卖家等额资金配合维权</div>

    <div v-if="loading && !cases.length" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="cases.length" class="card" style="overflow:hidden">
      <div
        v-for="c in cases"
        :key="c.id"
        class="msg-item"
        style="cursor:pointer"
        @click="router.push(`/rights/${c.id}`)"
      >
        <div style="flex:1; min-width:0">
          <div class="row wrap" style="gap:8px">
            <span class="badge" :class="rightsStatus(c.status).badge">{{ rightsStatus(c.status).label }}</span>
            <b style="font-size:14px">维权案 #{{ c.id }}</b>
            <span class="muted small">{{ c.order_summary ? `${c.order_summary.game_name} · ${c.order_summary.server_name}` : '订单已删除' }}</span>
          </div>
          <div class="muted small" style="margin-top:4px">
            <template v-if="c.order_summary">订单 {{ c.order_summary.order_no }} · 实付 {{ fmtPrice(c.order_summary.total) }} ·</template>
            发起于 {{ fmtDateTime(c.created_at) }}
            <template v-if="c.case_no"> · 案号 {{ c.case_no }}</template>
          </div>
          <div class="row wrap mt8" style="gap:6px">
            <span v-for="t in c.claim_types" :key="t" class="badge badge-primary">{{ claimTypeLabel(t) }}</span>
            <span v-if="c.freeze_amount > 0" class="badge badge-warning">已冻结卖家 ¥{{ fmtPrice(c.freeze_amount).slice(1) }}</span>
          </div>
          <div class="muted small mt8">{{ rightsStatus(c.status).hint }}</div>
        </div>
        <div style="text-align:right; flex:none">
          <div class="small muted">主张损失</div>
          <div style="font-size:16px; font-weight:700; color:var(--danger)">{{ fmtPrice(c.loss) }}</div>
          <div class="muted small" style="margin-top:4px">进入详情 →</div>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <EmptyState text="还没有维权案。若已完成交易的账号被卖家找回，请从「我的订单」进入订单详情发起追账号维权" icon="🛡️">
        <button class="btn btn-primary" @click="router.push('/orders')">从订单页发起</button>
      </EmptyState>
    </div>
  </main>
</template>
