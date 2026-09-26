<script setup>
import { computed } from 'vue';

const props = defineProps({
  page: { type: Number, required: true },
  total: { type: Number, default: 0 },
  size: { type: Number, default: 20 },
});
const emit = defineEmits(['change']);

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));

const pageList = computed(() => {
  const p = props.page;
  const last = pages.value;
  const arr = [];
  const push = v => arr.push(v);
  if (last <= 7) {
    for (let i = 1; i <= last; i++) push(i);
    return arr;
  }
  push(1);
  if (p > 3) push('...');
  for (let i = Math.max(2, p - 1); i <= Math.min(last - 1, p + 1); i++) push(i);
  if (p < last - 2) push('...');
  push(last);
  return arr;
});

function go(p) {
  if (p < 1 || p > pages.value || p === props.page) return;
  emit('change', p);
}
</script>

<template>
  <div v-if="pages > 1" class="pagination">
    <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
    <template v-for="(p, i) in pageList" :key="`${p}-${i}`">
      <span v-if="p === '...'" class="info">…</span>
      <button v-else class="btn btn-sm" :class="p === page ? 'btn-primary' : 'btn-ghost'" @click="go(p)">{{ p }}</button>
    </template>
    <button class="btn btn-ghost btn-sm" :disabled="page >= pages" @click="go(page + 1)">下一页</button>
    <span class="info">共 {{ total }} 条</span>
  </div>
</template>
