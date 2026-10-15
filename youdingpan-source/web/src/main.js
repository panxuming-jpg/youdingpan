import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { initStore } from './store.js';
import { connectSSE } from './sse.js';
import './styles.css';

async function boot() {
  await initStore();
  connectSSE();
  createApp(App).use(router).mount('#app');
}

boot();
