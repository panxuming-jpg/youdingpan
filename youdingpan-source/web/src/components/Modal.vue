<script setup>
defineProps({
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @mousedown.self="emit('close')">
      <div class="modal" :class="{ 'modal-wide': wide }">
        <div class="modal-head">
          <div class="modal-title">{{ title }}</div>
          <button class="modal-close" aria-label="关闭" @click="emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.foot" class="modal-foot">
          <slot name="foot" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
