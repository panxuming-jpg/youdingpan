<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { onNotify } from '../sse.js';
import Modal from '../components/Modal.vue';

const route = useRoute();
const id = Number(route.params.id);

const data = ref(null);
const loading = ref(true);
const now = ref(Date.now());
let timer = null;
let pollTimer = null;

const showBid = ref(false);
const bidAmount = ref('');
const bidLoading = ref(false);

const wallet = ref(null);

const isActive = computed(() => data.value?.status === 'active');
const remain = computed(() => (isActive.value ? Math.max(0, data.value.end_at - now.value) : 0));
const remainText = computed(() => {
  if (!isActive.value) return '已结束';
  const ms = remain.value;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}时${m}分${s}秒` : `${m}分${s}秒`;
});
const minBid = computed(() => {
  if (!data.value) return 0;
  return data.value.current_price ? data.value.current_price + data.value.increment : data.value.start_price;
});
const isSeller = computed(() => store.user && data.value?.seller_id === store.user.id);
const isLeader = computed(() => store.user && data.value?.current_leader_id === store.user.id);
const isEndingSoon = computed(() => isActive.value && remain.value < 5 * 60 * 1000);

async function load() {
  try {
    data.value = await api(`/auctions/${id}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadWallet() {
  if (!store.token) return;
  try {
    wallet.value = await api('/wallet');
  } catch { /* 静默 */ }
}

function openBid() {
  if (!store.token) return toast.error('请先登录后再出价');
  bidAmount.value = String(minBid.value);
  showBid.value = true;
}

async function submitBid() {
  const amt = Number(bidAmount.value);
  if (!Number.isFinite(amt) || amt < minBid.value) {
    return toast.error(`出价不能低于 ${fmtPrice(minBid.value)}`);
  }
  bidLoading.value = true;
  try {
    const res = await api(`/auctions/${id}/bid`, { method: 'POST', body: { amount: amt } });
    data.value = res;
    showBid.value = false;
    toast.success('出价成功！');
    loadWallet();
  } catch (e) {
    toast.error(e.message);
  } finally {
    bidLoading.value = false;
  }
}

async function cancelAuction() {
  if (!confirm('确定取消该拍卖吗？')) return;
  try {
    await api(`/auctions/${id}/cancel`, { method: 'POST' });
    toast.success('已取消');
    load();
  } catch (e) {
    toast.error(e.message);
  }
}

const offNotify = onNotify(() => load());

onMounted(() => {
  load();
  loadWallet();
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
  pollTimer = setInterval(load, 5000); // 5s 轮询最新价格
});
onUnmounted(() => {
  clearInterval(timer);
  clearInterval(pollTimer);
  offNotify();
});

function statusLabel(s) {
  return { active: '拍卖中', sold: '已成交', failed: '已流拍', cancelled: '已取消', completed: '已完成' }[s] || s;
}
function statusBadge(s) {
  return { active: 'badge-success', sold: 'badge-primary', failed: 'badge-warning', cancelled: 'badge-danger', completed: 'badge-primary' }[s] || 'badge-primary';
}
</script>

<template>
  <main class="container page">
    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <template v-else-if="data">
      <!-- 头部信息 -->
      <div class="card card-pad mb16">
        <div class="row between wrap" style="gap:12px">
          <div style="flex:1; min-width:260px">
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <span class="badge" :class="statusBadge(data.status)">{{ statusLabel(data.status) }}</span>
              <span v-if="data.reserve_price" class="badge badge-warning">有保留价</span>
              <span v-if="data.extend_count > 0" class="badge badge-danger">已延时 {{ data.extend_count }} 次</span>
            </div>
            <h1 style="font-size:22px; margin:10px 0 6px; line-height:1.35">{{ data.title }}</h1>
            <div class="muted small">
              {{ data.game_name }} <span v-if="data.server_name">· {{ data.server_name }}</span>
              · 卖家：{{ data.seller_name }}
              · 发布时间 {{ fmtDateTime(data.created_at) }}
            </div>
          </div>
          <div style="text-align:right">
            <div class="small muted">距结束</div>
            <div style="font-size:28px; font-weight:800; font-variant-numeric:tabular-nums" :style="{ color: isEndingSoon ? 'var(--danger)' : 'var(--primary)' }">
              {{ remainText }}
            </div>
            <div v-if="isEndingSoon" class="small" style="color:var(--danger)">最后 5 分钟出价将自动延时</div>
          </div>
        </div>
      </div>

      <div class="row" style="gap:16px; align-items:flex-start; flex-wrap:wrap">
        <!-- 左侧：图片与描述 -->
        <div style="flex:1; min-width:300px">
          <div class="card" style="overflow:hidden; margin-bottom:16px">
            <div class="goods-thumb" style="height:280px">
              <img v-if="data.images && data.images.length" :src="data.images[0]" :alt="data.title" style="width:100%; height:100%; object-fit:cover" />
              <span v-else class="goods-thumb-empty">暂无图片</span>
            </div>
            <div class="card-pad">
              <div class="card-title">账号描述</div>
              <div style="white-space:pre-wrap; line-height:1.7; color:var(--text2)">{{ data.description || '卖家未填写详细描述' }}</div>
            </div>
          </div>

          <!-- 出价记录 -->
          <div class="card card-pad">
            <div class="card-title">出价记录（{{ data.bid_count }}）</div>
            <div v-if="data.bids.length" class="table-wrap">
              <table class="table">
                <thead><tr><th>竞拍人</th><th>出价金额</th><th>时间</th></tr></thead>
                <tbody>
                  <tr v-for="b in data.bids" :key="b.id">
                    <td>
                      {{ b.nickname }}
                      <span v-if="b.user_id === data.current_leader_id" class="badge badge-success" style="margin-left:6px">领先</span>
                    </td>
                    <td style="font-weight:600; color:var(--danger)">{{ fmtPrice(b.amount) }}</td>
                    <td class="muted">{{ fmtDateTime(b.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="muted small" style="padding:12px 0">暂无出价记录</div>
          </div>
        </div>

        <!-- 右侧：出价面板 -->
        <div style="width:340px; flex:none">
          <div class="card card-pad" style="position:sticky; top:76px">
            <div class="card-title">出价竞拍</div>

            <div class="mb16">
              <div class="row between" style="margin-bottom:8px">
                <span class="muted">起拍价</span>
                <b>{{ fmtPrice(data.start_price) }}</b>
              </div>
              <div class="row between" style="margin-bottom:8px">
                <span class="muted">当前最高价</span>
                <b style="color:var(--danger); font-size:18px">{{ data.current_price ? fmtPrice(data.current_price) : '暂无出价' }}</b>
              </div>
              <div class="row between" style="margin-bottom:8px">
                <span class="muted">加价幅度</span>
                <b>{{ fmtPrice(data.increment) }}</b>
              </div>
              <div class="row between" style="margin-bottom:8px">
                <span class="muted">保证金</span>
                <b>{{ fmtPrice(data.deposit) }}</b>
              </div>
              <div class="row between" v-if="data.reserve_price">
                <span class="muted">保留价</span>
                <b class="muted">有（未达保留价将流拍）</b>
              </div>
            </div>

            <template v-if="isActive">
              <button v-if="!store.token" class="btn btn-primary btn-block btn-lg" @click="openBid">登录后出价</button>
              <button v-else-if="isSeller" class="btn btn-ghost btn-block" disabled>我是卖家</button>
              <button v-else-if="isLeader" class="btn btn-ghost btn-block" disabled>我当前领先</button>
              <button v-else class="btn btn-primary btn-block btn-lg" @click="openBid">立即出价</button>

              <div v-if="isSeller && data.bid_count === 0" class="mt8">
                <button class="btn btn-danger-ghost btn-block btn-sm" @click="cancelAuction">取消拍卖（无出价时可取消）</button>
              </div>
            </template>

            <div v-else-if="data.status === 'sold'" class="mt16" style="text-align:center">
              <div style="font-size:24px; font-weight:800; color:var(--success)">{{ fmtPrice(data.final_price) }}</div>
              <div class="small muted mt8">成交价</div>
            </div>
            <div v-else-if="data.status === 'failed'" class="mt16 muted" style="text-align:center">本场拍卖已流拍</div>
            <div v-else-if="data.status === 'cancelled'" class="mt16 muted" style="text-align:center">本场拍卖已取消</div>

            <div v-if="wallet" class="mt16 small muted" style="border-top:1px solid var(--border); padding-top:12px">
              我的余额：{{ fmtPrice(wallet.balance) }}（冻结 {{ fmtPrice(wallet.frozen) }}）
            </div>
          </div>
        </div>
      </div>

      <!-- 出价弹窗 -->
      <Modal v-if="showBid" title="确认出价" @close="showBid = false">
        <div class="modal-body">
          <div class="form-item">
            <label class="form-label">当前最低可出价</label>
            <div style="font-size:18px; font-weight:700; color:var(--danger)">{{ fmtPrice(minBid) }}</div>
          </div>
          <div class="form-item">
            <label class="form-label">我的出价 <span class="req">*</span></label>
            <input v-model="bidAmount" type="number" class="input" :min="minBid" :step="data.increment" placeholder="输入出价金额" />
            <div class="form-hint">需缴纳保证金 {{ fmtPrice(data.deposit) }}（未中标自动退回）；最后 5 分钟内出价将自动延时 5 分钟</div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showBid = false">取消</button>
          <button class="btn btn-primary" :disabled="bidLoading" @click="submitBid">
            {{ bidLoading ? '提交中…' : '确认出价' }}
          </button>
        </div>
      </Modal>
    </template>
  </main>
</template>
