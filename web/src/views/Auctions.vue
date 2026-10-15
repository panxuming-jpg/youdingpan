<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice } from '../utils.js';
import { store } from '../store.js';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const games = ref([]);
const list = ref([]);
const loading = ref(false);
const gameId = ref('');
const status = ref('active');
const keyword = ref('');
const sort = ref('ending');

const STATUS_TABS = [
  { key: 'active', label: '拍卖中' },
  { key: 'sold', label: '已成交' },
  { key: 'failed', label: '已流拍' },
  { key: '', label: '全部' },
];

// 倒计时刷新
const now = ref(Date.now());
let timer = null;
onMounted(() => {
  loadGames();
  load();
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
});
onUnmounted(() => clearInterval(timer));

async function loadGames() {
  try {
    games.value = await api('/games');
  } catch { /* 静默 */ }
}

async function load() {
  loading.value = true;
  try {
    list.value = await api('/auctions', {
      query: { game_id: gameId.value, status: status.value, keyword: keyword.value, sort: sort.value },
    });
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function switchStatus(k) {
  status.value = k;
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

function isEndingSoon(a) {
  return a.status === 'active' && (a.end_at - now.value) < 5 * 60 * 1000;
}

function statusLabel(s) {
  return { active: '拍卖中', sold: '已成交', failed: '已流拍', cancelled: '已取消', completed: '已完成' }[s] || s;
}

function statusBadge(s) {
  return { active: 'badge-success', sold: 'badge-primary', failed: 'badge-warning', cancelled: 'badge-danger', completed: 'badge-primary' }[s] || 'badge-primary';
}

function goDetail(id) {
  router.push(`/auctions/${id}`);
}
</script>

<template>
  <main class="container page">
    <div class="row between mb16 wrap" style="gap:12px">
      <div>
        <div class="page-title">游拍卖</div>
        <div class="page-sub" style="margin-bottom:0">游戏账号公开竞价 · 平台担保交易</div>
      </div>
      <div class="row" style="gap:10px">
        <RouterLink v-if="store.token" to="/auctions/mine" class="btn btn-ghost">我的拍卖</RouterLink>
        <RouterLink to="/auctions/publish" class="btn btn-primary">发布拍卖</RouterLink>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="card card-pad mb16">
      <div class="row wrap" style="gap:10px">
        <select v-model="gameId" class="select" style="width:140px" @change="load">
          <option value="">全部游戏</option>
          <option v-for="g in games" :key="g.id" :value="g.id">{{ g.short_name || g.name }}</option>
        </select>
        <select v-model="sort" class="select" style="width:130px" @change="load">
          <option value="ending">即将结束</option>
          <option value="price_asc">价格从低到高</option>
          <option value="price_desc">价格从高到低</option>
        </select>
        <input v-model="keyword" class="input" placeholder="搜索标题，空格分隔多个词（如：V10 皮肤）" style="flex:1; min-width:160px" @keyup.enter="load" />
        <button class="btn btn-primary" @click="load">搜索</button>
      </div>
    </div>

    <div class="tabs">
      <button v-for="t in STATUS_TABS" :key="t.key" class="tab" :class="{ active: status === t.key }" @click="switchStatus(t.key)">
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="list.length" class="goods-grid">
      <div v-for="a in list" :key="a.id" class="goods-card card" style="cursor:pointer" @click="goDetail(a.id)">
        <div class="goods-thumb" style="position:relative">
          <img v-if="a.images && a.images.length" :src="a.images[0]" :alt="a.title" loading="lazy" />
          <span v-else class="goods-thumb-empty">账号拍卖</span>
          <span v-if="isEndingSoon(a)" class="badge badge-danger" style="position:absolute; top:8px; right:8px; font-size:11px">即将结束</span>
        </div>
        <div style="padding:12px 14px; display:flex; flex-direction:column; gap:8px; flex:1">
          <div class="goods-title" :title="a.title">{{ a.title }}</div>
          <div class="goods-meta">
            <span>{{ a.game_name }}</span>
            <span v-if="a.server_name">· {{ a.server_name }}</span>
            <span>· {{ a.seller_name }}</span>
          </div>
          <div class="row between" style="margin-top:auto">
            <div>
              <div class="goods-price">{{ a.current_price ? fmtPrice(a.current_price) : fmtPrice(a.start_price) }}</div>
              <div class="small muted">{{ a.current_price ? '当前价' : '起拍价' }} · {{ a.bid_count }} 次出价</div>
            </div>
            <div style="text-align:right">
              <span class="badge" :class="statusBadge(a.status)">{{ statusLabel(a.status) }}</span>
              <div class="small" :style="{ color: isEndingSoon(a) ? 'var(--danger)' : 'var(--text3)', marginTop:'4px', fontWeight: isEndingSoon(a) ? 600 : 400 }">
                {{ countdown(a) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <EmptyState :text="status === 'active' ? '暂无拍卖中的账号，快来发布第一个吧' : '暂无数据'" icon="🔨" />
    </div>
  </main>
</template>
