<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { PLATFORMS, NOTIFY_TYPES, CHANNELS, fmtPrice } from '../utils.js';
import { toast } from '../toast.js';
import { store } from '../store.js';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';

const tasks = ref([]);
const games = ref([]);
const loading = ref(true);
const showModal = ref(false);
const editing = ref(null); // null=新建，否则为待编辑任务
const saving = ref(false);
const confirmDelete = ref(null);
const userEmail = ref('');
const mailEnabled = ref(true);

const emptyForm = () => ({
  name: '',
  game_id: '',
  server_id: '',
  platforms: [],
  price_min: '',
  price_max: '',
  keywords: '',
  notify_types: [],
  drop_threshold: '',
  channels: ['inapp'],
  status: 'on',
});
const form = reactive(emptyForm());

// 监控游戏下拉框：只列出平台当前已有在售商品的游戏（编辑时保留任务已选游戏）
const monitorGames = computed(() =>
  games.value.filter(g => g.goods_count > 0 || g.id === Number(form.game_id))
);

const serverOptions = computed(() => {
  const g = games.value.find(g => g.id === Number(form.game_id));
  return g?.servers || [];
});

const notifyMap = Object.fromEntries(NOTIFY_TYPES.map(t => [t.key, t.label]));
const channelMap = Object.fromEntries(CHANNELS.map(c => [c.key, c.label]));

function priceText(t) {
  if (t.price_min == null && t.price_max == null) return '不限';
  const min = t.price_min != null ? fmtPrice(t.price_min) : '不限';
  const max = t.price_max != null ? fmtPrice(t.price_max) : '不限';
  return `${min} ~ ${max}`;
}

function openCreate() {
  editing.value = null;
  Object.assign(form, emptyForm());
  userEmail.value = store.user?.email || '';
  showModal.value = true;
}

function openEdit(t) {
  editing.value = t;
  Object.assign(form, {
    name: t.name,
    game_id: t.game_id,
    server_id: t.server_id || '',
    platforms: [...t.platforms],
    price_min: t.price_min ?? '',
    price_max: t.price_max ?? '',
    keywords: t.keywords || '',
    notify_types: [...t.notify_types],
    drop_threshold: t.drop_threshold || '',
    channels: t.channels?.length ? [...t.channels] : ['inapp'],
    status: t.status,
  });
  userEmail.value = store.user?.email || '';
  showModal.value = true;
}

function onGameChange() {
  form.server_id = '';
}

function toggleArr(key, value) {
  const arr = form[key];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
}

// 平台选择：all 为聚合选项，选中时取消其他；选其他时取消 all
function togglePlatform(key) {
  const arr = form.platforms;
  if (key === 'all') {
    const i = arr.indexOf('all');
    if (i >= 0) arr.splice(i, 1);
    else { arr.length = 0; arr.push('all'); }
  } else {
    const ai = arr.indexOf('all');
    if (ai >= 0) arr.splice(ai, 1);
    const i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(key);
  }
}

function toggleChannel(key) {
  if (key === 'inapp') return; // 站内消息为基础渠道，始终保留
  toggleArr('channels', key);
}

async function load() {
  loading.value = true;
  try {
    tasks.value = await api('/tasks');
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!form.name.trim()) return toast.error('任务名称不能为空');
  if (!form.game_id) return toast.error('请选择监控游戏');
  if (!form.platforms.length) return toast.error('请至少选择一个监控平台');
  if (!form.notify_types.length) return toast.error('请至少选择一种监控类型');
  // 选择邮件渠道时必须填写接收邮箱（保存任务时同步到账号资料）
  if (form.channels.includes('email')) {
    if (!userEmail.value.trim()) return toast.error('请填写接收邮件提醒的邮箱');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.value.trim())) return toast.error('邮箱格式不正确');
  }

  const payload = {
    name: form.name.trim(),
    game_id: Number(form.game_id),
    server_id: form.server_id ? Number(form.server_id) : null,
    platforms: form.platforms,
    price_min: form.price_min === '' ? null : Number(form.price_min),
    price_max: form.price_max === '' ? null : Number(form.price_max),
    keywords: form.keywords.trim(),
    notify_types: form.notify_types,
    drop_threshold: form.notify_types.includes('drop') && form.drop_threshold !== '' ? Number(form.drop_threshold) : 0,
    channels: form.channels.length ? form.channels : ['inapp'],
    status: form.status,
  };
  if (payload.price_min != null && payload.price_max != null && payload.price_min > payload.price_max) {
    return toast.error('最低价不能高于最高价');
  }

  saving.value = true;
  try {
    // 邮件渠道：先把用户填写的邮箱同步到账号资料（有变更才请求）
    if (form.channels.includes('email') && userEmail.value.trim() !== (store.user?.email || '')) {
      const u = await api('/me', { method: 'PUT', body: { email: userEmail.value.trim() } });
      store.user = u;
    }
    if (editing.value) {
      await api(`/tasks/${editing.value.id}`, { method: 'PUT', body: payload });
      toast.success('任务已更新');
    } else {
      await api('/tasks', { method: 'POST', body: payload });
      toast.success('监控任务已创建');
    }
    showModal.value = false;
    load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(t) {
  const next = t.status === 'on' ? 'off' : 'on';
  try {
    await api(`/tasks/${t.id}/status`, { method: 'PUT', body: { status: next } });
    t.status = next;
    toast.success(next === 'on' ? '任务已开启' : '任务已暂停');
  } catch (e) {
    toast.error(e.message);
  }
}

async function doDelete() {
  if (!confirmDelete.value) return;
  try {
    await api(`/tasks/${confirmDelete.value.id}`, { method: 'DELETE' });
    toast.success('任务已删除');
    confirmDelete.value = null;
    load();
  } catch (e) {
    toast.error(e.message);
  }
}

onMounted(async () => {
  api('/games').then(gs => { games.value = gs; }).catch(() => {});
  api('/mail/status').then(d => { mailEnabled.value = !!d.enabled; }).catch(() => {});
  load();
});
</script>

<template>
  <main class="container page">
    <div class="row between mb16 wrap" style="gap:12px">
      <div>
        <div class="page-title">监控任务</div>
        <div class="page-sub" style="margin-bottom:0">符合条件的商品动态将通过站内消息实时提醒（可扩展微信 / 邮件渠道）</div>
      </div>
      <button class="btn btn-primary" @click="openCreate">+ 新建监控任务</button>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="tasks.length" style="display:flex; flex-direction:column; gap:12px">
      <div v-for="t in tasks" :key="t.id" class="card task-card">
        <div class="task-head">
          <span class="task-name">{{ t.name }}</span>
          <span class="badge" :class="t.status === 'on' ? 'badge-success' : 'badge-warning'">
            {{ t.status === 'on' ? '监控中' : '已暂停' }}
          </span>
          <span class="badge">触发 {{ t.trigger_count }} 次</span>
          <label class="switch" style="margin-left:auto" :title="t.status === 'on' ? '暂停任务' : '开启任务'">
            <input type="checkbox" :checked="t.status === 'on'" @change="toggleStatus(t)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="task-desc">
          <span>游戏：<b style="color:var(--text)">{{ t.game_name }}</b></span>
          <span>区服：{{ t.server_name || '全部' }}</span>
          <span>价格：{{ priceText(t) }}</span>
          <span v-if="t.keywords">关键词：<b style="color:var(--text)">{{ t.keywords }}</b></span>
          <span>监控：{{ t.notify_types.map(x => notifyMap[x] || x).join(' / ') }}</span>
          <span v-if="t.notify_types.includes('drop') && t.drop_threshold > 0">降价阈值：≥ {{ fmtPrice(t.drop_threshold) }}</span>
        </div>

        <div class="row wrap" style="gap:6px">
          <span v-for="p in t.platforms" :key="p" class="badge badge-primary">{{ PLATFORMS.find(x => x.key === p)?.name || p }}</span>
          <span v-for="c in t.channels" :key="c" class="badge">{{ channelMap[c] || c }}</span>
        </div>

        <div class="task-foot">
          <span class="muted small">创建于 {{ new Date(t.created_at).toLocaleString('zh-CN', { hour12: false }) }}</span>
          <div class="row" style="gap:8px">
            <button class="btn btn-ghost btn-sm" @click="openEdit(t)">编辑</button>
            <button class="btn btn-danger-ghost btn-sm" @click="confirmDelete = t">删除</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <EmptyState text="还没有监控任务，创建一个开始盯盘吧" icon="◎">
        <button class="btn btn-primary btn-sm" @click="openCreate">+ 新建监控任务</button>
      </EmptyState>
    </div>

    <!-- 新建 / 编辑任务 -->
    <Modal v-if="showModal" :title="editing ? '编辑监控任务' : '新建监控任务'" wide @close="showModal = false">
      <form @submit.prevent="save">
        <div class="form-item">
          <label class="form-label">任务名称<span class="req">*</span></label>
          <input v-model="form.name" class="input" maxlength="30" placeholder="如：原神天空岛 500 元以下降价提醒" />
        </div>

        <div class="form-row form-item">
          <div>
            <label class="form-label">监控游戏<span class="req">*</span></label>
            <select v-model="form.game_id" class="select" @change="onGameChange">
              <option value="">请选择游戏</option>
              <option v-for="g in monitorGames" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <div class="form-hint">仅显示当前有在售商品的游戏</div>
          </div>
          <div>
            <label class="form-label">区服（可选）</label>
            <select v-model="form.server_id" class="select" :disabled="!serverOptions.length">
              <option value="">全部区服</option>
              <option v-for="s in serverOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">监控平台<span class="req">*</span></label>
          <div class="row wrap" style="gap:8px">
            <span
              v-for="p in PLATFORMS"
              :key="p.key"
              class="chip"
              :class="{ active: form.platforms.includes(p.key) }"
              role="button"
              tabindex="0"
              @click="togglePlatform(p.key)"
              @keydown.enter.prevent="togglePlatform(p.key)"
            >{{ p.name }}</span>
          </div>
          <div class="form-hint">选择"全部平台"即监控所有平台的新动态</div>
        </div>

        <div class="form-row form-item">
          <div>
            <label class="form-label">价格下限</label>
            <input v-model="form.price_min" class="input" type="number" min="0" placeholder="不限" />
          </div>
          <div>
            <label class="form-label">价格上限</label>
            <input v-model="form.price_max" class="input" type="number" min="0" placeholder="不限" />
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">关键词（可选）</label>
          <input v-model="form.keywords" class="input" maxlength="100" placeholder="如：满命 胡桃 专武" />
          <div class="form-hint">多个关键词用空格分隔，商品标题或区服命中任一关键词才触发提醒；不填则不过滤</div>
        </div>

        <div class="form-item">
          <label class="form-label">监控类型<span class="req">*</span></label>
          <div class="row wrap" style="gap:14px">
            <label v-for="n in NOTIFY_TYPES" :key="n.key" class="check-row">
              <input type="checkbox" :checked="form.notify_types.includes(n.key)" @change="toggleArr('notify_types', n.key)" />
              {{ n.label }}
            </label>
          </div>
          <div v-if="form.notify_types.includes('drop')" class="mt8" style="max-width:240px">
            <input v-model="form.drop_threshold" class="input" type="number" min="0" step="0.01" placeholder="降价幅度阈值（元），不填默认 0" />
            <div class="form-hint">降幅达到阈值才提醒，避免小额波动打扰</div>
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">提醒渠道</label>
          <div class="row wrap" style="gap:14px">
            <label v-for="c in CHANNELS" :key="c.key" class="check-row" :class="{ disabled: c.key === 'inapp' }">
              <input
                type="checkbox"
                :checked="form.channels.includes(c.key)"
                :disabled="c.key === 'inapp'"
                @change="toggleChannel(c.key)"
              />
              {{ c.label }}{{ c.key === 'inapp' ? '（默认开启）' : '' }}
            </label>
          </div>
          <!-- 选择邮件渠道时要求填写接收邮箱，保存任务时同步到账号资料 -->
          <div v-if="form.channels.includes('email')" class="mt8" style="max-width:320px">
            <input v-model="userEmail" class="input" type="email" maxlength="50" placeholder="接收邮件提醒的邮箱地址" />
            <div class="form-hint" v-if="mailEnabled">保存任务时将同步更新到你的账号邮箱</div>
            <div class="form-hint" v-else style="color:var(--danger)">服务器暂未配置 SMTP，邮件提醒不会实际发出，仅作配置保存</div>
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">任务状态</label>
          <div class="row" style="gap:14px">
            <label class="check-row">
              <input v-model="form.status" type="radio" value="on" /> 立即开启
            </label>
            <label class="check-row">
              <input v-model="form.status" type="radio" value="off" /> 暂不开启
            </label>
          </div>
        </div>
      </form>

      <template #foot>
        <button class="btn btn-ghost" @click="showModal = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存任务' }}</button>
      </template>
    </Modal>

    <!-- 删除确认 -->
    <Modal v-if="confirmDelete" title="删除监控任务" @close="confirmDelete = null">
      <p>确定删除任务 <b>「{{ confirmDelete?.name }}」</b> 吗？删除后不可恢复。</p>
      <template #foot>
        <button class="btn btn-ghost" @click="confirmDelete = null">取消</button>
        <button class="btn btn-danger" @click="doDelete">确认删除</button>
      </template>
    </Modal>
  </main>
</template>
