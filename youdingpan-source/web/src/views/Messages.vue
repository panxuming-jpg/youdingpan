<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { notifyLabel } from '../utils.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { onNotify } from '../sse.js';
import Pagination from '../components/Pagination.vue';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const TABS = [
  { key: '', label: '全部' },
  { key: 'new', label: '新上架' },
  { key: 'drop', label: '降价' },
  { key: 'off', label: '已下架' },
  { key: 'system', label: '系统' },
];

const tab = ref('');
const page = ref(1);
const size = 20;
const total = ref(0);
const unread = ref(0);
const list = ref([]);
const loading = ref(false);

const TYPE_COLORS = { new: 'badge-success', drop: 'badge-warning', off: 'badge-danger', system: 'badge-primary' };

async function load() {
  loading.value = true;
  try {
    const d = await api('/messages', { query: { page: page.value, size, type: tab.value } });
    list.value = d.list;
    total.value = d.total;
    unread.value = d.unread;
    store.unread = d.unread;
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

function switchTab(key) {
  tab.value = key;
  page.value = 1;
  load();
}

async function markAll() {
  try {
    const d = await api('/messages/read', { method: 'PUT', body: { all: true } });
    unread.value = d.unread;
    store.unread = d.unread;
    list.value.forEach(n => { n.is_read = true; });
    toast.success('已全部标记为已读');
  } catch (e) {
    toast.error(e.message);
  }
}

async function markRead(n) {
  if (n.is_read) return;
  try {
    const d = await api('/messages/read', { method: 'PUT', body: { ids: [n.id] } });
    n.is_read = true;
    unread.value = d.unread;
    store.unread = d.unread;
  } catch { /* 静默失败 */ }
}

function openMsg(n) {
  markRead(n);
  if (n.goods_id) router.push(`/goods/${n.goods_id}`);
}

const offNotify = onNotify(() => load());
onMounted(load);
onUnmounted(() => offNotify());
</script>

<template>
  <main class="container page">
    <div class="row between mb16 wrap" style="gap:12px">
      <div>
        <div class="page-title">消息中心</div>
        <div class="page-sub" style="margin-bottom:0">
          未读消息 <b style="color:var(--danger)">{{ unread }}</b> 条 · 监控命中后将实时推送
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" :disabled="unread === 0 || loading" @click="markAll">全部标记已读</button>
    </div>

    <div class="tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="switchTab(t.key)"
      >{{ t.label }}</button>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="list.length" class="card" style="overflow:hidden">
      <div
        v-for="n in list"
        :key="n.id"
        class="msg-item"
        :class="{ unread: !n.is_read }"
        @click="openMsg(n)"
      >
        <span class="msg-dot" :class="{ read: n.is_read }"></span>
        <div style="flex:1; min-width:0">
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <span class="badge" :class="TYPE_COLORS[n.type] || 'badge-primary'">{{ n.type_label || notifyLabel(n.type) }}</span>
            <b style="font-size:14px">{{ n.title }}</b>
          </div>
          <div class="muted small" style="margin-top:3px">{{ n.content }}</div>
        </div>
        <div style="text-align:right; flex:none">
          <div class="muted small">{{ n.time_str }}</div>
          <div v-if="n.goods_id" class="small" style="color:var(--primary); margin-top:4px">查看商品 →</div>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <EmptyState text="暂无消息，监控命中后会第一时间通知你" icon="✉" />
    </div>

    <Pagination :page="page" :total="total" :size="size" @change="p => { page = p; load(); }" />
  </main>
</template>
