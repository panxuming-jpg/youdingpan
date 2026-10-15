<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { CHANNELS, fmtDateTime, fmtPrice } from '../utils.js';
import { store, logout } from '../store.js';
import { toast } from '../toast.js';
import PayModal from '../components/PayModal.vue';

const router = useRouter();

const form = reactive({
  nickname: '',
  email: '',
  push_channels: ['inapp'],
});
const saving = ref(false);
const mailEnabled = ref(true);

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

// ---------- 会员中心 ----------
const member = ref(null);
const memberOrders = ref([]);
const showOrders = ref(false);
const payOrder = ref(null);

async function loadMember() {
  try {
    member.value = await api('/member/status');
  } catch (e) {
    toast.error(e.message);
  }
}

async function toggleOrders() {
  showOrders.value = !showOrders.value;
  if (showOrders.value && !memberOrders.value.length) {
    try {
      memberOrders.value = await api('/member/orders');
    } catch (e) {
      toast.error(e.message);
    }
  }
}

async function openMemberPay() {
  try {
    payOrder.value = await api('/pay/orders', { method: 'POST', body: { scene: 'member' } });
  } catch (e) {
    toast.error(e.message);
  }
}

async function onPaySuccess() {
  payOrder.value = null;
  toast.success('会员已开通，全部商品已解锁');
  try { store.user = await api('/me'); } catch { /* 静默 */ }
  loadMember();
  memberOrders.value = [];
  if (showOrders.value) {
    try { memberOrders.value = await api('/member/orders'); } catch { /* 静默 */ }
  }
}

function payStatusLabel(s) {
  return { pending: '待支付', paid: '支付成功', closed: '已关闭', timeout: '已超时' }[s] || s;
}

onMounted(async () => {
  if (store.user) {
    fillFromUser(store.user);
  }
  api('/mail/status').then(d => { mailEnabled.value = !!d.enabled; }).catch(() => {});
  loadMember();
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
      <div style="display:flex; flex-direction:column; gap:16px">
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

        <!-- 会员中心 -->
        <div class="card card-pad">
          <div class="card-title">会员中心</div>
          <template v-if="member">
            <div class="member-status" :class="{ 'member-active': member.is_member }">
              <div style="font-weight:700; font-size:15px">
                {{ member.is_member ? '会员有效期内' : '暂未开通会员' }}
              </div>
              <div class="muted small" style="margin-top:4px">
                <template v-if="member.is_member">有效期至 {{ fmtDateTime(member.member_expire_at) }}</template>
                <template v-else>免费用户可浏览 {{ member.free_view_limit }} 个商品，开通会员查看全部</template>
              </div>
            </div>
            <div class="muted small mt8" style="line-height:1.7">
              {{ member.benefits || '会员有效期内无限查看全部商品，无数量上限' }}
            </div>
            <button class="btn btn-primary btn-block mt16" @click="openMemberPay">
              {{ member.is_member ? `续费会员 ${fmtPrice(member.price)}/${member.days}天` : `开通会员 ${fmtPrice(member.price)}/${member.days}天` }}
            </button>
            <button class="btn btn-ghost btn-block mt8 btn-sm" @click="toggleOrders">
              {{ showOrders ? '收起订阅记录' : '历史订阅记录' }}
            </button>
            <div v-if="showOrders" class="mt8">
              <div v-if="memberOrders.length" class="member-orders">
                <div v-for="o in memberOrders" :key="o.order_no" class="member-order-row">
                  <div style="min-width:0">
                    <div style="font-size:13px; font-weight:600">{{ o.subject }}</div>
                    <div class="muted small">{{ fmtDateTime(o.created_at) }}</div>
                  </div>
                  <div style="text-align:right; flex:none">
                    <div style="font-size:13px; font-weight:700">{{ fmtPrice(o.amount) }}</div>
                    <span class="badge" :class="o.status === 'paid' ? 'badge-success' : (o.status === 'pending' ? 'badge-warning' : '')">{{ payStatusLabel(o.status) }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="muted small" style="text-align:center; padding:10px 0">暂无订阅记录</div>
            </div>
          </template>
          <div v-else class="muted small">会员状态加载中…</div>
        </div>

        <!-- 我的钱包 -->
        <div class="card card-pad">
          <div class="card-title">我的钱包</div>
          <p class="muted small" style="line-height:1.7">拍卖卖出货款结算后进入钱包余额，可申请提现至微信 / 支付宝。</p>
          <RouterLink to="/wallet"><button class="btn btn-ghost btn-block mt8">查看余额与提现</button></RouterLink>
        </div>
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
            <input v-model="form.email" class="input" type="email" maxlength="50" placeholder="用于接收邮件提醒，如 you@example.com" />
            <div class="form-hint" v-if="mailEnabled">监控任务 / 收藏商品触发邮件渠道时，提醒将发送到此邮箱</div>
            <div class="form-hint" v-else style="color:var(--danger)">服务器暂未配置 SMTP 发信，邮箱仅作保存，邮件提醒不会实际发出</div>
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
            <div class="form-hint">推送渠道作用于收藏商品的降价/下架提醒；监控任务的提醒渠道在任务内单独勾选</div>
          </div>

          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存修改' }}</button>
        </form>
      </div>
    </div>

    <!-- 会员开通 / 续费收银台 -->
    <PayModal v-if="payOrder" :pay-order="payOrder" @close="payOrder = null" @success="onPaySuccess" />
  </main>
</template>

<style scoped>
.member-status {
  border-radius: 10px; padding: 12px 14px; background: var(--bg, #f5f6f8);
}
.member-active { background: var(--success-weak, #e8f7ef); }
.progress-bar { height: 6px; border-radius: 3px; background: var(--bg, #eef0f2); overflow: hidden; }
.progress-inner { height: 100%; border-radius: 3px; background: var(--primary); transition: width .3s; }
.member-orders { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow: auto; }
.member-order-row {
  display: flex; justify-content: space-between; gap: 10px;
  border: 1px solid var(--border, #e8eaef); border-radius: 8px; padding: 8px 10px;
}
</style>
