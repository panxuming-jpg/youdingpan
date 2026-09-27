<script setup>
defineProps({
  text: { type: String, default: '暂无数据' },
  icon: { type: String, default: '⋯' },
});
const emit = defineEmits(['action']);
</script>

<template>
  <div class="empty">
    <div class="empty-icon">{{ icon }}</div>
    <div class="empty-text">{{ text }}</div>
    <slot />
  </div>
</template>
