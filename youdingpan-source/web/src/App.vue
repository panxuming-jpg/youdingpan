<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, logout } from './store.js';
import { connectSSE, closeSSE } from './sse.js';
import { toasts, toast } from './toast.js';
import Modal from './components/Modal.vue';

const route = useRoute();
const router = useRouter();

watch(() => store.token, t => (t ? connectSSE() : closeSSE()), { immediate: true });

const navs = computed(() => {
  const list = [
    { path: '/market', label: '商品市场' },
    { path: '/tasks', label: '监控任务', auth: true },
    { path: '/messages', label: '消息中心', auth: true, badge: () => store.unread },
  ];
  if (store.user?.is_admin) list.push({ path: '/admin', label: '管理后台' });
  return list.filter(n => !n.auth || store.token);
});

function isActive(nav) {
  return route.path === nav.path || route.path.startsWith(nav.path + '/');
}

function handleLogout() {
  logout();
  toast.info('已退出登录');
  router.push('/');
}

// 咨询与反馈二维码
const showContact = ref(false);
</script>

<template>
  <header class="navbar">
    <div class="navbar-inner">
      <RouterLink to="/" class="logo">
        <span class="logo-mark">游</span>
        <span>游盯盘</span>
      </RouterLink>
      <nav class="nav-links">
        <RouterLink
          v-for="nav in navs"
          :key="nav.path"
          :to="nav.path"
          class="nav-link"
          :class="{ active: isActive(nav) }"
        >
          {{ nav.label }}
          <span v-if="nav.badge && nav.badge() > 0" class="nav-badge">{{ nav.badge() > 99 ? '99+' : nav.badge() }}</span>
        </RouterLink>
      </nav>
      <div class="nav-right">
        <template v-if="store.user">
          <RouterLink to="/profile" class="nav-user">
            <b>{{ store.user.nickname }}</b>
            <span v-if="store.user.is_admin" class="badge badge-primary" style="margin-left:6px">管理员</span>
          </RouterLink>
          <button class="btn btn-ghost btn-sm" @click="handleLogout">退出</button>
        </template>
        <RouterLink v-else to="/login" class="btn btn-primary btn-sm">登录 / 注册</RouterLink>
      </div>
    </div>
  </header>

  <RouterView />

  <footer class="site-footer">
    账号交易存在风险，本工具仅信息展示，不参与交易、不提供担保。商品数据来自各平台公开页面，请以原平台为准并遵守其用户协议。
  </footer>

  <div class="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast-${t.type}`">{{ t.message }}</div>
  </div>

  <!-- 咨询与反馈悬浮入口 -->
  <button class="contact-fab" @click="showContact = true" aria-label="咨询与反馈">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H6l-2 2V4h16z"/>
    </svg>
    <span class="contact-fab-text">咨询反馈</span>
  </button>

  <Modal v-if="showContact" title="咨询与意见反馈" @close="showContact = false">
    <div class="contact-modal">
      <p class="contact-desc">有任何问题或建议，欢迎扫码添加微信咨询，我们会尽快回复。</p>
      <div class="contact-qr-wrap">
        <img src="/contact-qr.png" alt="微信二维码" class="contact-qr" />
      </div>
      <p class="contact-tip">打开微信 → 扫一扫 → 添加好友</p>
    </div>
  </Modal>
</template>
