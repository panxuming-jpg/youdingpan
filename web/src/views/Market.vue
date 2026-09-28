<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { PLATFORMS } from '../utils.js';
import { toast } from '../toast.js';
import { store } from '../store.js';
import GoodsCard from '../components/GoodsCard.vue';
import Pagination from '../components/Pagination.vue';
import EmptyState from '../components/EmptyState.vue';
import PayModal from '../components/PayModal.vue';

const route = useRoute();
const router = useRouter();

const games = ref([]);
// 游戏 tab：只展示当前有在售商品的游戏（稳定 id 顺序）
const gameTabs = computed(() => games.value.filter(g => g.goods_count > 0));
const filters = reactive({
  keyword: String(route.query.keyword || ''),
  game_id: route.query.game_id || '',
  platforms: route.query.platforms ? String(route.query.platforms).split(',') : [],
  price_min: '',
  price_max: '',
  sort: String(route.query.sort || ''),
  favorited: route.query.favorited === '1',
});
const page = ref(1);
const size = 20;
const total = ref(0);
const list = ref([]);
const loading = ref(false);
const locked = ref(false);
const freeViewLimit = ref(10);
const memberPayOrder = ref(null);

const SORTS = [
  { key: '', label: '最新上架' },
  { key: 'lowest', label: '价格最低' },
  { key: 'drop', label: '降价优先' },
];

let kwTimer = null;
watch(() => filters.keyword, () => {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(() => { page.value = 1; load(); }, 350);
});
watch(() => [filters.game_id, filters.sort], () => { page.value = 1; load(); });

// 切换游戏 tab，并同步到 URL（便于分享/刷新保持）
function selectGame(id) {
  filters.game_id = id;
  const query = { ...route.query };
  if (id) query.game_id = id;
  else delete query.game_id;
  router.replace({ query });
}

function toggleChip(key, value) {
  const arr = filters[key];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
  page.value = 1;
  load();
}

function togglePlatform(key) {
  const arr = filters.platforms;
  if (key === 'all') {
    const i = arr.indexOf('all');
    if (i >= 0) arr.splice(i, 1);
    else { arr.length = 0; arr.push('all'); }
  } else {
    const ai = arr.indexOf('all');
    if (ai >= 0) arr.splice(ai, 1);
    const i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(key);
  }
  page.value = 1;
  load();
}

function toggleFavorited() {
  if (!store.token) {
    toast.info('请先登录后查看收藏');
    router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  filters.favorited = !filters.favorited;
  page.value = 1;
  load();
}

function resetFilters() {
  filters.keyword = '';
  filters.game_id = '';
  filters.platforms = [];
  filters.price_min = '';
  filters.price_max = '';
  filters.sort = '';
  filters.favorited = false;
  page.value = 1;
  load();
}

function applyPrice() {
  page.value = 1;
  load();
}

async function load() {
  loading.value = true;
  try {
    const d = await api('/goods', {
      query: {
        game_id: filters.game_id,
        platforms: filters.platforms.join(','),
        price_min: filters.price_min,
        price_max: filters.price_max,
        sort: filters.sort,
        keyword: filters.keyword,
        favorited: filters.favorited ? '1' : '',
        page: page.value,
        size,
      },
    });
    list.value = d.list;
    total.value = d.total;
    locked.value = !!d.locked;
    if (d.free_view_limit) freeViewLimit.value = d.free_view_limit;
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function openMemberPay() {
  if (!store.token) {
    toast.info('请先登录后开通会员');
    router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  if (memberPayOrder.value) return;
  try {
    memberPayOrder.value = await api('/pay/orders', { method: 'POST', body: { scene: 'member' } });
  } catch (e) {
    toast.error(e.message);
  }
}

async function onPaySuccess() {
  memberPayOrder.value = null;
  toast.success('会员已开通，全部商品已解锁');
  try { store.user = await api('/me'); } catch { /* 静默 */ }
  page.value = 1;
  load();
}

onMounted(async () => {
  try {
    games.value = await api('/games');
    // 默认选中第一款有在售商品的游戏（URL 未指定 game_id 时）；selectGame 的 watcher 会触发首次加载
    if (!filters.game_id && gameTabs.value.length) {
      selectGame(String(gameTabs.value[0].id));
      return;
    }
  } catch { /* 游戏列表失败不阻塞商品加载 */ }
  load();
});
</script>

<template>
  <main class="container page">
    <div class="page-title">商品市场</div>
    <div class="page-sub">全平台在售账号聚合，支持按游戏、平台、价格筛选与最新上架排序</div>

    <!-- 游戏切换 tab：默认选中当前有在售商品的第一款游戏 -->
    <div class="tabs game-tabs">
      <button
        class="tab"
        :class="{ active: filters.game_id === '' }"
        @click="selectGame('')"
      >全部游戏</button>
      <button
        v-for="g in gameTabs"
        :key="g.id"
        class="tab"
        :class="{ active: String(g.id) === String(filters.game_id) }"
        @click="selectGame(String(g.id))"
      >{{ g.name }}</button>
    </div>

    <div class="card card-pad mb16">
      <div class="row wrap" style="gap:12px">
        <input
          v-model="filters.keyword"
          class="input"
          style="flex:2; min-width:200px"
          placeholder="搜索标题 / 区服，如：满命、V区"
        />
        <select v-model="filters.sort" class="select" style="flex:1; min-width:130px">
          <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>

      <div class="row wrap mt16" style="gap:8px">
        <span class="muted small" style="width:44px">平台</span>
        <span
          v-for="p in PLATFORMS"
          :key="p.key"
          class="chip"
          :class="{ active: filters.platforms.includes(p.key) }"
          role="button"
          tabindex="0"
          @click="togglePlatform(p.key)"
          @keydown.enter.prevent="togglePlatform(p.key)"
        >{{ p.name }}</span>
        <span class="chip" :class="{ active: filters.favorited }" role="button" tabindex="0" @click="toggleFavorited" @keydown.enter.prevent="toggleFavorited">我的收藏</span>
      </div>

      <div class="row wrap mt16 between">
        <div class="row" style="gap:8px">
          <span class="muted small">价格区间</span>
          <input v-model="filters.price_min" class="input" type="number" min="0" placeholder="最低价" style="width:110px" @keydown.enter="applyPrice" />
          <span class="muted">-</span>
          <input v-model="filters.price_max" class="input" type="number" min="0" placeholder="最高价" style="width:110px" @keydown.enter="applyPrice" />
          <button class="btn btn-ghost btn-sm" @click="applyPrice">确定</button>
        </div>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置筛选</button>
      </div>
    </div>

    <div v-if="store.user && !store.user.is_member && !locked" class="muted small mb16" style="padding:0 4px">
      当前仅展示部分商品，
      <router-link to="/profile" style="color:var(--primary); font-weight:600">开通会员查看全部 →</router-link>
    </div>

    <div v-if="filters.favorited" class="mb16">
      <span class="badge badge-primary">当前查看：我的收藏</span>
    </div>

    <div v-if="loading" class="loading-box">
      <div class="spinner"></div>
      正在加载商品…
    </div>
    <template v-else>
      <div v-if="list.length" class="goods-grid">
        <GoodsCard v-for="g in list" :key="g.id" :goods="g" />
      </div>
      <div v-else class="card">
        <EmptyState text="没有符合条件的商品，试试放宽筛选条件" />
      </div>

      <!-- 非会员解锁卡片 -->
      <div v-if="locked" class="unlock-card card card-pad" style="text-align:center; margin-top:16px">
        <div style="font-size:14px; color:var(--text2)">已展示 {{ list.length }} 个商品，还有 {{ total - list.length }} 个更多商品</div>
        <div style="font-size:18px; font-weight:700; margin:8px 0">开通会员，查看全部 {{ total }} 个商品</div>
        <div class="muted small" style="margin-bottom:14px">9.9 元 / 月 · 无限查看全部商品详情 · 新上架/降价优先提醒</div>
        <button class="btn btn-primary" @click="openMemberPay">开通会员查看更多</button>
      </div>
    </template>

    <!-- 分页仅对会员/游客显示 -->
    <Pagination v-if="!locked" :page="page" :total="total" :size="size" @change="p => { page = p; load(); }" />

    <!-- 收银台 -->
    <PayModal v-if="memberPayOrder" :pay-order="memberPayOrder" @close="memberPayOrder = null" @success="onPaySuccess" />
  </main>
</template>
