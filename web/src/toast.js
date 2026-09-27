import { reactive } from 'vue';

export const toasts = reactive([]);
let seq = 0;

export function toast(message, type = 'info', duration = 2600) {
  const id = ++seq;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex(t => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, duration);
}

toast.success = msg => toast(msg, 'success');
toast.error = msg => toast(msg, 'error');
toast.info = msg => toast(msg, 'info');
