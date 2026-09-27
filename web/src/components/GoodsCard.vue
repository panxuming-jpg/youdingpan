<script setup>
import { useRouter, useRoute } from 'vue-router';
import { api } from '../api.js';
import { platformName, fmtPrice } from '../utils.js';
import { toast } from '../toast.js';
import { store } from '../store.js';

const props = defineProps({
  goods: { type: Object, required: true },
});
const emit = defineEmits(['fav-change']);
const router = useRouter();
const route = useRoute();

function openDetail() {
  router.push(`/goods/${props.goods.id}`);
}

// 图片加载失败（防盗链/失效）时隐藏 img，显示平台占位
function onThumbError(e) {
  props.goods.thumb = '';
  e.target.style.display = 'none';
}

async function toggleFav() {
  if (!store.token) {
    toast.info('请先登录后再收藏');
    router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  try {
    const d = await api(`/favorites/${props.goods.id}/toggle`, { method: 'POST' });
    props.goods.is_favorited = d.favorited;
    toast.success(d.favorited ? '已加入收藏' : '已取消收藏');
    emit('fav-change', { id: props.goods.id, favorited: d.favorited });
  } catch (e) {
    toast.error(e.message);
  }
}
</script>

<template>
  <div class="goods-card" @click="openDetail">
    <div class="goods-thumb">
      <img v-if="goods.thumb" :src="goods.thumb" :alt="goods.title" loading="lazy" referrerpolicy="no-referrer" @error="onThumbError" />
      <span v-else class="goods-thumb-empty">{{ goods.platform_name || platformName(goods.platform) }}</span>
    </div>

    <div class="goods-top">
      <span class="badge badge-primary">{{ goods.platform_name || platformName(goods.platform) }}</span>
      <span class="badge">{{ goods.game_name }}</span>
      <span v-if="goods.server_name" class="badge">{{ goods.server_name }}</span>
      <button
        class="fav-btn"
        :class="{ active: goods.is_favorited }"
        style="margin-left:auto"
        :title="goods.is_favorited ? '取消收藏' : '收藏'"
        @click.stop="toggleFav"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" :fill="goods.is_favorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    </div>

    <div class="goods-title">{{ goods.title }}</div>

    <div class="goods-tags">
      <span v-for="t in goods.tags" :key="t" class="goods-tag">{{ t }}</span>
    </div>

    <div class="goods-bottom">
      <div>
        <span class="goods-price">{{ fmtPrice(goods.price) }}</span>
        <span v-if="goods.original_price && goods.original_price > goods.price" class="goods-price-original">{{ fmtPrice(goods.original_price) }}</span>
      </div>
      <span v-if="goods.last_drop > 0" class="goods-drop">降 {{ fmtPrice(goods.last_drop) }}</span>
    </div>

    <div class="goods-meta">
      <span>{{ goods.publish_time_str }}</span>
      <span v-if="goods.lowest_price && goods.lowest_price < goods.price">· 历史低价 {{ fmtPrice(goods.lowest_price) }}</span>
    </div>
  </div>
</template>
