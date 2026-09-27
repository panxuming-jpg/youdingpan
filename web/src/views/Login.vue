<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { setAuth } from '../store.js';
import { toast } from '../toast.js';

const route = useRoute();
const router = useRouter();

const form = reactive({ phone: '', code: '' });
const sending = ref(false);
const submitting = ref(false);
const demoCode = ref('');
const countdown = ref(0);

let timer = null;

async function sendCode() {
  if (!/^1\d{10}$/.test(form.phone)) {
    toast.error('请输入正确的 11 位手机号');
    return;
  }
  sending.value = true;
  try {
    const d = await api('/auth/send-code', { method: 'POST', body: { phone: form.phone } });
    demoCode.value = d.code;
    toast.success('验证码已发送（演示模式已自动回显）');
    countdown.value = 60;
    clearInterval(timer);
    timer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (e) {
    toast.error(e.message);
  } finally {
    sending.value = false;
  }
}

async function submit() {
  if (!/^1\d{10}$/.test(form.phone)) {
    toast.error('请输入正确的 11 位手机号');
    return;
  }
  if (!form.code.trim()) {
    toast.error('请输入验证码');
    return;
  }
  submitting.value = true;
  try {
    const d = await api('/auth/login', { method: 'POST', body: { phone: form.phone, code: form.code.trim() } });
    setAuth(d.token, d.user);
    toast.success(`欢迎回来，${d.user.nickname}`);
    router.push(String(route.query.redirect || '/'));
  } catch (e) {
    toast.error(e.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="card login-card">
      <div class="login-title">登录游盯盘</div>
      <div class="login-sub">全平台游戏账号比价监控，一网打尽</div>

      <form @submit.prevent="submit">
        <div class="form-item">
          <label class="form-label">手机号</label>
          <input v-model="form.phone" class="input" type="tel" maxlength="11" placeholder="请输入手机号" autocomplete="tel" />
        </div>

        <div class="form-item">
          <label class="form-label">验证码</label>
          <div class="code-row">
            <input v-model="form.code" class="input" type="text" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code" @keydown.enter="submit" />
            <button type="button" class="btn btn-ghost" :disabled="sending || countdown > 0" @click="sendCode">
              {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
            </button>
          </div>
          <div v-if="demoCode" class="form-hint">演示环境：本次验证码为 <b>{{ demoCode }}</b>（通用验证码 123456 也可登录）</div>
        </div>

        <button class="btn btn-primary btn-lg btn-block" type="submit" :disabled="submitting">
          {{ submitting ? '登录中…' : '登录 / 注册' }}
        </button>
      </form>

      <p class="form-hint" style="text-align:center; margin-top:16px">
        未注册的手机号将自动创建账号；登录即代表同意仅将本工具用于信息比价参考。
      </p>
    </div>
  </div>
</template>
