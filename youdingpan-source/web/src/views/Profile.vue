<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { CHANNELS } from '../utils.js';
import { store, logout } from '../store.js';
import { toast } from '../toast.js';

const router = useRouter();

const form = reactive({
  nickname: '',
  email: '',
  push_channels: ['inapp'],
});
const saving = ref(false);

function fillFromUser(u) {
  if (!u) return;
  form.nickname = u.nickname || '';
  form.email = u.email || '';
  form.push_channels = u.push_channels?.length ? [...u.push_channels] : ['inapp'];
}

function toggleChannel(key) {
  if (key === 'inapp') return; // 站内消息始终开启
  const i = form.push_channels.indexOf(key);
  if (i >= 0) form.push_channels.splice(i, 1);
  else form.push_channels.push(key);
}

async function save() {
  if (!form.nickname.trim()) return toast.error('昵称不能为空');
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    return toast.error('邮箱格式不正确');
  }
  saving.value = true;
  try {
    const d = await api('/me', {
      method: 'PUT',
      body: {
        nickname: form.nickname.trim(),
        email: form.email.trim(),
        push_channels: form.push_channels.length ? form.push_channels : ['inapp'],
      },
    });
    store.user = d;
    fillFromUser(d);
    toast.success('资料已保存');
  } catch (e) {
    toast.error(e.message);
  } finally {
    saving.value = false;
  }
}

function handleLogout() {
  logout();
  toast.info('已退出登录');
  router.push('/');
}

onMounted(async () => {
  if (store.user) {
    fillFromUser(store.user);
  }
  // 拉取最新资料，避免与其他端的修改不同步
  try {
    const d = await api('/me');
    store.user = d;
    fillFromUser(d);
  } catch { /* 忽略 */ }
});
</script>

<template>
  <main class="container page">
    <div class="page-title">个人中心</div>
    <div class="page-sub">管理账号资料与推送偏好</div>

    <div class="detail-grid" style="grid-template-columns: 320px 1fr;">
      <div class="card card-pad">
        <div class="card-title">账号信息</div>
        <dl class="kv-list">
          <dt>用户 ID</dt><dd>#{{ store.user?.id }}</dd>
          <dt>手机号</dt><dd>{{ store.user?.phone }}</dd>
          <dt>角色</dt><dd>
            <span class="badge" :class="store.user?.is_admin ? 'badge-primary' : ''">
              {{ store.user?.is_admin ? '管理员' : '普通用户' }}
            </span>
          </dd>
        </dl>
        <button class="btn btn-danger-ghost btn-block mt16" @click="handleLogout">退出登录</button>
      </div>

      <div class="card card-pad">
        <div class="card-title">编辑资料</div>
        <form @submit.prevent="save">
          <div class="form-item">
            <label class="form-label">昵称</label>
            <input v-model="form.nickname" class="input" maxlength="20" placeholder="给自己起个名字" />
            <div class="form-hint">最多 20 个字符</div>
          </div>

          <div class="form-item">
            <label class="form-label">邮箱（选填）</label>
            <input v-model="form.email" class="input" type="email" maxlength="50" placeholder="用于接收邮件提醒" />
          </div>

          <div class="form-item">
            <label class="form-label">推送渠道</label>
            <div class="row wrap" style="gap:14px">
              <label
                v-for="c in CHANNELS"
                :key="c.key"
                class="check-row"
                :style="c.key === 'inapp' ? 'opacity:.6' : ''"
              >
                <input
                  type="checkbox"
                  :checked="form.push_channels.includes(c.key)"
                  :disabled="c.key === 'inapp'"
                  @change="toggleChannel(c.key)"
                />
                {{ c.label }}{{ c.key === 'inapp' ? '（默认开启）' : '' }}
              </label>
            </div>
            <div class="form-hint">演示环境仅实现站内消息推送，微信 / 邮件渠道为配置项预留</div>
          </div>

          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存修改' }}</button>
        </form>
      </div>
    </div>
  </main>
</template>
