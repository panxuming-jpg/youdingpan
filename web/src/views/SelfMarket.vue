<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { gameCover, fmtPrice, fmtDateTime } from '../utils.js';
import { toast } from '../toast.js';
import Pagination from '../components/Pagination.vue';
import EmptyState from '../components/EmptyState.vue';

const route = useRoute();
const router = useRouter();

const games = ref([]);
const filters = reactive({
  keyword: '',
  game_id: route.query.game_id || '',
  price_min: '',
  price_max: '',
  sort: String(route.query.sort || ''),
});
const page = ref(1);
const size = 12;
const loading = ref(false);
const all = ref([]);

// 后端 sort 参数：'' 最新上架 | price_asc 价格低到高 | value 性价比（估值置信度+性价比分）
const SORTS = [
  { key: '', label: '最新上架' },
  { key: 'value', label: '性价比优先' },
  { key: 'price_asc', label: '价格从低到高' },
];

const CONF_LABEL = { high: '高置信', mid: '中置信', low: '低置信' };
const GRADE_COLOR = { '优秀': 'var(--success)', '良好': 'var(--primary)', '一般': 'var(--warning)', '较差': 'var(--danger)' };

// 关键词为前端过滤（后端列表返回全量在售/锁定商品）
const filtered = computed(() => {
  const kw = filters.keyword.trim().toLowerCase();
  if (!kw) return all.value;
  return all.value.filter(item => {
    const hay = [
      item.game_name, item.server_name, item.account_mask, item.seller_name, item.channel, item.description,
      ...Object.values(item.assets || {}),
    ].join(' ').toLowerCase();
    return hay.includes(kw);
  });
});
const list = computed(() => filtered.value.slice((page.value - 1) * size, page.value * size));

function selectGame(id) {
  filters.game_id = id;
  const query = { ...route.query };
  if (id) query.game_id = id;
  else delete query.game_id;
  router.replace({ query });
}

function applyPrice() {
  page.value = 1;
}

function resetFilters() {
  filters.keyword = '';
  filters.game_id = '';
  filters.price_min = '';
  filters.price_max = '';
  filters.sort = '';
  page.value = 1;
  load();
}

watch(() => [filters.game_id, filters.sort, filters.price_min, filters.price_max], () => {
  page.value = 1;
  load();
});
watch(() => filters.keyword, () => { page.value = 1; });

function onImgError(e) {
  e.target.style.display = 'none';
}

async function load() {
  loading.value = true;
  try {
    const d = await api('/self/listings', {
      query: {
        game_id: filters.game_id,
        price_min: filters.price_min,
        price_max: filters.price_max,
        sort: filters.sort,
      },
    });
    all.value = d.list || [];
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openDetail(item) {
  router.push(`/self/${item.id}`);
}

onMounted(async () => {
  try {
    games.value = await api('/games');
  } catch { /* 游戏列表失败不阻塞商品加载 */ }
  load();
});
</script>

<template>
  <main class="container page">
    <div class="page-title">安全交易市场</div>
    <div class="page-sub">C2C 账号交易：卖家实名上架 + 信用分认证 + AI 估值定价 + 每笔交易客服全程服务，货款支付宝托管，支持找回包赔与鉴号服务</div>

    <!-- 游戏切换 tab -->
    <div class="game-tabs">
      <button class="game-tab" :class="{ active: filters.game_id === '' }" @click="selectGame('')">
        <span class="game-tab-img game-tab-all" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8"/>
          </svg>
        </span>
        <span class="game-tab-name">全部游戏</span>
      </button>
      <button
        v-for="g in games"
        :key="g.id"
        class="game-tab"
        :class="{ active: String(g.id) === String(filters.game_id) }"
        :title="g.name"
        @click="selectGame(String(g.id))"
      >
        <span class="game-tab-img">
          <span class="game-tab-fallback">{{ (g.short_name || g.name).slice(0, 1) }}</span>
          <img v-if="gameCover(g.name)" :src="gameCover(g.name)" :alt="g.name" loading="lazy" @error="onImgError" />
        </span>
        <span class="game-tab-name">{{ g.short_name || g.name }}</span>
      </button>
    </div>

    <div class="card card-pad mb16">
      <div class="row wrap" style="gap:12px">
        <input
          v-model="filters.keyword"
          class="input"
          style="flex:2; min-width:200px"
          placeholder="搜索区服 / 账号 / 资产，如：V区、典藏、满命"
        />
        <select v-model="filters.sort" class="select" style="flex:1; min-width:130px">
          <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>
      <div class="row wrap mt16 between">
        <div class="row" style="gap:8px">
          <span class="muted small">价格区间</span>
          <input v-model="filters.price_min" class="input" type="number" min="0" placeholder="最低价" style="width:110px" @keydown.enter="applyPrice" />
          <span class="muted">-</span>
          <input v-model="filters.price_max" class="input" type="number" min="0" placeholder="最高价" style="width:110px" @keydown.enter="applyPrice" />
        </div>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置筛选</button>
      </div>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>正在加载安全交易商品…</div>
    <template v-else>
      <div v-if="list.length" class="goods-grid">
        <div v-for="item in list" :key="item.id" class="goods-card" @click="openDetail(item)">
          <div class="goods-thumb">
            <img v-if="item.images && item.images.length" :src="item.images[0]" :alt="item.game_name" loading="lazy" @error="onImgError" />
            <span v-else class="goods-thumb-empty">{{ item.game_name }}</span>
          </div>

          <div class="goods-top">
            <span class="badge badge-primary">卖家上架</span>
            <span v-if="item.seller_credit && item.seller_credit.credit_grade" class="badge" :style="{ color: GRADE_COLOR[item.seller_credit.credit_grade] }">信用{{ item.seller_credit.credit_grade }}</span>
            <span class="badge">{{ item.game_name }}</span>
            <span v-if="item.server_name" class="badge">{{ item.server_name }}</span>
            <span v-if="item.status === 'locked'" class="badge badge-danger">交易中</span>
          </div>

          <div class="goods-title">{{ item.game_name }}账号 · {{ item.account_mask }}</div>

          <div class="goods-tags">
            <span v-if="item.verified" class="goods-tag" style="color:var(--success)">已验归属</span>
            <span v-if="item.support_compensation" class="goods-tag" style="color:var(--primary)">支持找回包赔</span>
            <span v-for="(v, k) in Object.entries(item.assets || {}).slice(0, 3)" :key="k" class="goods-tag">{{ v }}</span>
          </div>

          <div class="goods-bottom">
            <div>
              <span class="goods-price">{{ fmtPrice(item.price) }}</span>
              <span v-if="item.valuation" class="goods-price-original" style="text-decoration:none">AI 估值 {{ fmtPrice(item.valuation.mid) }}</span>
            </div>
            <span
              v-if="item.valuation && (item.valuation.confidence === 'high' || item.valuation.confidence === 'mid')"
              class="goods-drop"
              :style="item.valuation.score >= 70 ? '' : 'color:var(--text2); background:var(--bg)'"
            >性价比 {{ item.valuation.score }} 分</span>
          </div>

          <div class="goods-meta">
            <span v-if="item.seller_name">{{ item.seller_name }}</span>
            <span v-if="item.seller_credit" :style="{ color: item.seller_credit.online ? 'var(--success)' : '' }">{{ item.seller_credit.online ? '● 在线' : '○ ' + (item.seller_credit.last_active_text || '离线') }}</span>
            <span v-if="item.valuation">· 估值 {{ CONF_LABEL[item.valuation.confidence] || '' }}</span>
            <span v-if="item.listed_at">· {{ fmtDateTime(item.listed_at) }}上架</span>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="暂无符合条件的安全交易商品，可切换游戏或放宽筛选条件" />
      </div>

      <Pagination :page="page" :total="filtered.length" :size="size" @change="p => { page = p; }" />
    </template>
  </main>
</template>
