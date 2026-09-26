<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime, platformName, PLATFORM_LINKS } from '../utils.js';
import { toast } from '../toast.js';
import { store } from '../store.js';
import PriceChart from '../components/PriceChart.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';

const route = useRoute();
const router = useRouter();

const detail = ref(null);
const history = ref([]);
const days = ref(7);
const loading = ref(true);
const failed = ref(false);

async function loadDetail() {
  loading.value = true;
  failed.value = false;
  try {
    detail.value = await api(`/goods/${route.params.id}`);
  } catch (e) {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadHistory() {
  try {
    history.value = await api(`/goods/${route.params.id}/history`, { query: { days: days.value } });
  } catch {
    history.value = [];
  }
}

watch(days, loadHistory);

async function toggleFav() {
  if (!store.token) {
    toast.info('请先登录后再收藏');
    router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  try {
    const d = await api(`/favorites/${detail.value.id}/toggle`, { method: 'POST' });
    detail.value.is_favorited = d.favorited;
    toast.success(d.favorited ? '已加入收藏' : '已取消收藏');
  } catch (e) {
    toast.error(e.message);
  }
}

// 直达源平台：先弹风险提示，确认后新窗口打开
const showLeave = ref(false);
function askLeave() {
  showLeave.value = true;
}
function confirmLeave() {
  showLeave.value = false;
  // 优先用商品直达链接（每条商品的原平台详情页），无则退回平台主页
  const url = detail.value.source_url || PLATFORM_LINKS[detail.value.platform];
  if (url) window.open(url, '_blank', 'noopener');
  else toast.info('该商品暂无原平台直达链接，请通过官方渠道查看');
}

onMounted(() => {
  loadDetail();
  loadHistory();
});
</script>

<template>
  <main class="container page">
    <div class="row mb16" style="gap:6px; color:var(--text2); font-size:13px">
      <RouterLink to="/market" style="color:var(--primary)">商品市场</RouterLink>
      <span>/</span>
      <span>商品详情</span>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="failed || !detail" class="card">
      <EmptyState text="商品不存在或已下架">
        <RouterLink to="/market"><button class="btn btn-primary btn-sm">返回商品市场</button></RouterLink>
      </EmptyState>
    </div>

    <div v-else class="detail-grid">
      <div style="display:flex; flex-direction:column; gap:16px">
        <div class="card card-pad">
          <div class="row wrap" style="gap:6px; margin-bottom:10px">
            <span class="badge badge-primary">{{ detail.platform_name || platformName(detail.platform) }}</span>
            <span class="badge">{{ detail.game_name }}</span>
            <span v-if="detail.server_name" class="badge">{{ detail.server_name }}</span>
            <span v-if="detail.status !== 'on'" class="badge badge-danger">已下架</span>
            <span v-for="t in detail.tags" :key="t" class="badge badge-success">{{ t }}</span>
          </div>

          <h1 style="font-size:20px; font-weight:700; line-height:1.5; margin-bottom:12px">{{ detail.title }}</h1>

          <div class="price-block">
            <span class="price-current">{{ fmtPrice(detail.price) }}</span>
            <span v-if="detail.original_price && detail.original_price > detail.price" class="goods-price-original" style="font-size:14px">
              原价 {{ fmtPrice(detail.original_price) }}
            </span>
            <span v-if="detail.last_drop > 0" class="badge badge-success">近期降价 {{ fmtPrice(detail.last_drop) }}</span>
          </div>
          <div class="price-lowest mt8">
            历史最低价：<b style="color:var(--success)">{{ fmtPrice(detail.lowest_price) }}</b>
            <span v-if="detail.publish_time_str" style="margin-left:12px">发布于 {{ detail.publish_time_str }}</span>
          </div>
        </div>

        <div class="card card-pad">
          <div class="row between" style="margin-bottom:8px">
            <div class="card-title" style="margin-bottom:0">价格走势</div>
            <div class="row" style="gap:6px">
              <button class="btn btn-sm" :class="days === 7 ? 'btn-primary' : 'btn-ghost'" @click="days = 7">近 7 天</button>
              <button class="btn btn-sm" :class="days === 30 ? 'btn-primary' : 'btn-ghost'" @click="days = 30">近 30 天</button>
            </div>
          </div>
          <PriceChart :points="history" />
        </div>

        <div class="card card-pad">
          <div class="card-title">商品描述</div>
          <p class="muted" style="white-space:pre-wrap; line-height:1.8">{{ detail.description || '卖家未填写描述' }}</p>
        </div>

        <div v-if="detail.images && detail.images.length" class="card card-pad">
          <div class="card-title">验证图（{{ detail.images.length }} 张）</div>
          <div class="img-grid">
            <a v-for="(img, i) in detail.images" :key="i" :href="img" target="_blank" rel="noopener" class="img-ph img-ph-link">
              <img :src="img" :alt="`验证图 ${i + 1}`" loading="lazy" referrerpolicy="no-referrer" />
            </a>
          </div>
          <p class="form-hint mt8">点击图片可查看大图，商品信息以原平台商品页为准。</p>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px">
        <div class="card card-pad">
          <div class="card-title">交易信息</div>
          <dl class="kv-list">
            <dt>所属平台</dt><dd>{{ detail.platform_name || platformName(detail.platform) }}</dd>
            <dt>游戏</dt><dd>{{ detail.game_name }}</dd>
            <dt>区服</dt><dd>{{ detail.server_name || '-' }}</dd>
            <dt>商品状态</dt><dd>
              <span class="badge" :class="detail.status === 'on' ? 'badge-success' : 'badge-danger'">
                {{ detail.status === 'on' ? '在售中' : '已下架' }}
              </span>
            </dd>
          </dl>
          <button
            class="btn btn-block mt16"
            :class="detail.is_favorited ? 'btn-ghost' : 'btn-primary'"
            @click="toggleFav"
          >
            {{ detail.is_favorited ? '已收藏 · 取消收藏' : '收藏该商品' }}
          </button>
          <button class="btn btn-ghost btn-block mt8" @click="askLeave">前往源平台查看</button>
          <p class="form-hint" style="margin-top:10px">
            本平台仅提供跨平台信息聚合与比价提醒，不参与任何交易。请前往原平台查看并交易，注意账号安全。
          </p>
        </div>

        <div class="card card-pad">
          <div class="card-title">盯住这件商品</div>
          <p class="muted small">创建监控任务后，该商品降价、下架或同类新上架都会第一时间提醒你。</p>
          <RouterLink to="/tasks"><button class="btn btn-ghost btn-block mt8">去创建监控任务</button></RouterLink>
        </div>
      </div>
    </div>

    <Modal v-if="showLeave" title="风险提示" @close="showLeave = false">
      <p style="line-height:1.8">
        即将离开本工具，前往<b>{{ detail.platform_name || platformName(detail.platform) }}</b>查看相关内容。
      </p>
      <p style="line-height:1.8; color:var(--danger, #fa3534)">
        账号交易存在风险，本工具仅信息展示，不参与任何交易、不提供任何担保。请自行核实商品真实性并遵守平台规则。
      </p>
      <template #foot>
        <button class="btn btn-ghost" @click="showLeave = false">取消</button>
        <button class="btn btn-primary" @click="confirmLeave">我已知晓风险，继续前往</button>
      </template>
    </Modal>
  </main>
</template>
