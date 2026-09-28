<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { CATEGORIES, fmtDateTime, fmtPrice } from '../utils.js';
import { toast } from '../toast.js';
import Modal from '../components/Modal.vue';
import Pagination from '../components/Pagination.vue';
import EmptyState from '../components/EmptyState.vue';

const tab = ref('overview');

// ---------- 总览 ----------
const overview = ref(null);
const overviewLoading = ref(true);

async function loadOverview() {
  overviewLoading.value = true;
  try {
    overview.value = await api('/admin/overview');
  } catch (e) {
    toast.error(e.message);
  } finally {
    overviewLoading.value = false;
  }
}

async function togglePlatform(p) {
  try {
    const d = await api(`/admin/platform/${p.platform}/toggle`, {
      method: 'POST',
      body: { running: !p.running },
    });
    p.running = d.running;
    toast.success(d.running ? `已恢复同步：${p.name}` : `已暂停同步：${p.name}`);
  } catch (e) {
    toast.error(e.message);
  }
}

function platStatusBadge(s) {
  return s === 'normal' ? 'badge-success' : 'badge-danger';
}
function platStatusText(s) {
  return s === 'normal' ? '正常' : '异常';
}

// ---------- 采集日志 ----------
const logs = ref([]);
const logTotal = ref(0);
const logPage = ref(1);
const logPlatform = ref('');
const LOG_SIZE = 20;

async function loadLogs() {
  try {
    const d = await api('/admin/logs', { query: { page: logPage.value, platform: logPlatform.value } });
    logs.value = d.list;
    logTotal.value = d.total;
  } catch (e) {
    toast.error(e.message);
  }
}

function switchLogPlatform() {
  logPage.value = 1;
  loadLogs();
}

function platformNameOf(key) {
  return overview.value?.platforms.find(p => p.platform === key)?.name || key;
}

// ---------- 游戏管理 ----------
const games = ref([]);
const gamesLoading = ref(true);
const gameModal = ref(false);
const editingGame = ref(null);
const deletingGame = ref(null);
const expandedGame = ref(null);
const gameForm = reactive({ name: '', short_name: '', pinyin: '', tags: '', category: '手游' });
const serverForm = reactive({ name: '', type: '官服' });
const savingGame = ref(false);

async function loadGames() {
  gamesLoading.value = true;
  try {
    games.value = await api('/admin/games');
  } catch (e) {
    toast.error(e.message);
  } finally {
    gamesLoading.value = false;
  }
}

function openCreateGame() {
  editingGame.value = null;
  Object.assign(gameForm, { name: '', short_name: '', pinyin: '', tags: '', category: '手游' });
  gameModal.value = true;
}

function openEditGame(g) {
  editingGame.value = g;
  Object.assign(gameForm, {
    name: g.name,
    short_name: g.short_name || '',
    pinyin: g.pinyin || '',
    tags: (g.tags || []).join('，'),
    category: g.category || '手游',
  });
  gameModal.value = true;
}

async function saveGame() {
  if (!gameForm.name.trim()) return toast.error('游戏名称不能为空');
  const payload = {
    name: gameForm.name.trim(),
    short_name: gameForm.short_name.trim(),
    pinyin: gameForm.pinyin.trim(),
    tags: gameForm.tags.split(/[,，\s]+/).filter(Boolean),
    category: gameForm.category,
  };
  savingGame.value = true;
  try {
    if (editingGame.value) {
      await api(`/admin/games/${editingGame.value.id}`, { method: 'PUT', body: payload });
      toast.success('游戏已更新');
    } else {
      await api('/admin/games', { method: 'POST', body: payload });
      toast.success('游戏已添加');
    }
    gameModal.value = false;
    loadGames();
  } catch (e) {
    toast.error(e.message);
  } finally {
    savingGame.value = false;
  }
}

async function toggleGameStatus(g) {
  try {
    await api(`/admin/games/${g.id}`, { method: 'PUT', body: { status: g.status ? 0 : 1 } });
    g.status = g.status ? 0 : 1;
    toast.success(g.status ? `已启用：${g.name}` : `已停用：${g.name}`);
  } catch (e) {
    toast.error(e.message);
  }
}

async function doDeleteGame() {
  if (!deletingGame.value) return;
  try {
    await api(`/admin/games/${deletingGame.value.id}`, { method: 'DELETE' });
    toast.success('游戏已删除');
    deletingGame.value = null;
    loadGames();
  } catch (e) {
    toast.error(e.message);
    deletingGame.value = null;
  }
}

function toggleExpand(g) {
  expandedGame.value = expandedGame.value?.id === g.id ? null : g;
  serverForm.name = '';
  serverForm.type = '官服';
}

async function addServer(g) {
  if (!serverForm.name.trim()) return toast.error('区服名称不能为空');
  try {
    await api(`/admin/games/${g.id}/servers`, {
      method: 'POST',
      body: { name: serverForm.name.trim(), type: serverForm.type },
    });
    serverForm.name = '';
    toast.success('区服已添加');
    loadGames();
  } catch (e) {
    toast.error(e.message);
  }
}

async function removeServer(s) {
  try {
    await api(`/admin/servers/${s.id}`, { method: 'DELETE' });
    toast.success('区服已删除');
    loadGames();
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 公告管理 ----------
const anns = ref([]);
const annForm = reactive({ title: '', content: '' });
const posting = ref(false);
const deletingAnn = ref(null);

async function loadAnns() {
  try {
    anns.value = await api('/admin/announcements');
  } catch (e) {
    toast.error(e.message);
  }
}

async function postAnn() {
  if (!annForm.title.trim()) return toast.error('公告标题不能为空');
  posting.value = true;
  try {
    await api('/admin/announcements', {
      method: 'POST',
      body: { title: annForm.title.trim(), content: annForm.content.trim() },
    });
    annForm.title = '';
    annForm.content = '';
    toast.success('公告已发布');
    loadAnns();
  } catch (e) {
    toast.error(e.message);
  } finally {
    posting.value = false;
  }
}

async function doDeleteAnn() {
  if (!deletingAnn.value) return;
  try {
    await api(`/admin/announcements/${deletingAnn.value.id}`, { method: 'DELETE' });
    toast.success('公告已删除');
    deletingAnn.value = null;
    loadAnns();
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 会员管理 ----------
const members = ref([]);
const grantUser = ref(null);
const grantDays = ref(30);
const granting = ref(false);

async function loadMembers() {
  try {
    members.value = await api('/admin/members');
  } catch (e) {
    toast.error(e.message);
  }
}

function openGrant(u) {
  grantUser.value = u;
  grantDays.value = 30;
}

async function submitGrant() {
  const days = Number(grantDays.value);
  if (!days || days <= 0) return toast.error('请输入有效天数');
  granting.value = true;
  try {
    await api(`/admin/members/${grantUser.value.id}/grant`, { method: 'POST', body: { days } });
    toast.success(`已为 ${grantUser.value.nickname || grantUser.value.phone} 开通 ${days} 天会员`);
    grantUser.value = null;
    loadMembers();
  } catch (e) {
    toast.error(e.message);
  } finally {
    granting.value = false;
  }
}

// ---------- 支付流水 ----------
const payOrders = ref([]);
const payScene = ref('');
const payStatus = ref('');

const PAY_STATUS = {
  pending: { label: '待支付', badge: 'badge-warning' },
  paid: { label: '支付成功', badge: 'badge-success' },
  closed: { label: '已关闭', badge: 'badge-danger' },
  timeout: { label: '已超时', badge: 'badge-danger' },
};
const PAY_SCENE = { member: '会员订阅', auction: '拍卖担保' };
const CHANNEL_LABELS = { wechat: '微信支付', alipay: '支付宝' };

async function loadPayOrders() {
  try {
    payOrders.value = await api('/admin/pay-orders', { query: { scene: payScene.value, status: payStatus.value } });
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 担保交易 ----------
const auctionOrders = ref([]);
const aoStatus = ref('');

const ORDER_STATUS = {
  pending_payment: { label: '待支付', badge: 'badge-warning' },
  pending_ship: { label: '待发货', badge: 'badge-primary' },
  pending_confirm: { label: '待确认收货', badge: 'badge-primary' },
  completed: { label: '交易完成', badge: 'badge-success' },
  cancelled: { label: '已关闭', badge: 'badge-danger' },
  refunded: { label: '已退款', badge: 'badge-danger' },
  after_sale: { label: '售后中', badge: 'badge-warning' },
};

async function loadAuctionOrders() {
  try {
    auctionOrders.value = await api('/admin/auction-orders', { query: { status: aoStatus.value } });
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 提现审核 ----------
const withdrawList = ref([]);
const wdStatus = ref('');
const wdAction = ref(null); // { w, action: 'approve' | 'reject' }
const wdRemark = ref('');
const wdSubmitting = ref(false);

const WITHDRAW_STATUS = {
  pending: { label: '待审核', badge: 'badge-warning' },
  paid: { label: '提现成功', badge: 'badge-success' },
  rejected: { label: '已驳回', badge: 'badge-danger' },
};

async function loadWithdraws() {
  try {
    withdrawList.value = await api('/admin/withdraws', { query: { status: wdStatus.value } });
  } catch (e) {
    toast.error(e.message);
  }
}

function openWdAction(w, action) {
  wdAction.value = { w, action };
  wdRemark.value = '';
}

async function submitWdAction() {
  const { w, action } = wdAction.value;
  wdSubmitting.value = true;
  try {
    await api(`/admin/withdraws/${w.id}/${action}`, { method: 'POST', body: { remark: wdRemark.value.trim() } });
    toast.success(action === 'approve' ? '已审核通过并打款' : '已驳回，资金已退回用户余额');
    wdAction.value = null;
    loadWithdraws();
  } catch (e) {
    toast.error(e.message);
  } finally {
    wdSubmitting.value = false;
  }
}

// ---------- 资金流水 ----------
const fundLogs = ref([]);
const fundBiz = ref('');

const BIZ_LABELS = {
  member_pay: '会员支付',
  auction_pay: '拍卖支付',
  escrow_settle: '交易结算',
  refund: '退款',
  withdraw: '提现',
  withdraw_reject: '提现退回',
  deposit_compensate: '保证金赔付',
  member_grant: '后台开通',
  fee: '平台手续费',
};
function bizLabel(b) {
  return BIZ_LABELS[b] || b;
}

async function loadFundLogs() {
  try {
    fundLogs.value = await api('/admin/fund-logs', { query: { biz: fundBiz.value } });
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 系统设置 ----------
const settingsList = ref([]);
const settingsEdit = reactive({});
const savingSettings = ref(false);

async function loadSettings() {
  try {
    const list = await api('/admin/settings');
    settingsList.value = list;
    list.forEach(s => { settingsEdit[s.key] = s.value; });
  } catch (e) {
    toast.error(e.message);
  }
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    const settings = {};
    settingsList.value.forEach(s => { settings[s.key] = String(settingsEdit[s.key] ?? s.value); });
    await api('/admin/settings', { method: 'PUT', body: { settings } });
    toast.success('设置已保存');
    loadSettings();
  } catch (e) {
    toast.error(e.message);
  } finally {
    savingSettings.value = false;
  }
}

function switchTab(key) {
  tab.value = key;
  if (key === 'overview') loadOverview();
  else if (key === 'logs') loadLogs();
  else if (key === 'games') loadGames();
  else if (key === 'anns') loadAnns();
  else if (key === 'members') loadMembers();
  else if (key === 'payorders') loadPayOrders();
  else if (key === 'auctionorders') loadAuctionOrders();
  else if (key === 'withdraws') loadWithdraws();
  else if (key === 'fundlogs') loadFundLogs();
  else if (key === 'settings') loadSettings();
}

onMounted(() => {
  loadOverview();
  loadGames();
  loadAnns();
});
</script>

<template>
  <main class="container page">
    <div class="page-title">管理后台</div>
    <div class="page-sub">平台运行状态、同步日志与基础数据维护</div>

    <div class="tabs" style="flex-wrap:wrap">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="switchTab('overview')">运行总览</button>
      <button class="tab" :class="{ active: tab === 'logs' }" @click="switchTab('logs')">同步日志</button>
      <button class="tab" :class="{ active: tab === 'games' }" @click="switchTab('games')">游戏管理</button>
      <button class="tab" :class="{ active: tab === 'anns' }" @click="switchTab('anns')">公告管理</button>
      <button class="tab" :class="{ active: tab === 'members' }" @click="switchTab('members')">会员管理</button>
      <button class="tab" :class="{ active: tab === 'payorders' }" @click="switchTab('payorders')">支付流水</button>
      <button class="tab" :class="{ active: tab === 'auctionorders' }" @click="switchTab('auctionorders')">担保交易</button>
      <button class="tab" :class="{ active: tab === 'withdraws' }" @click="switchTab('withdraws')">提现审核</button>
      <button class="tab" :class="{ active: tab === 'fundlogs' }" @click="switchTab('fundlogs')">资金流水</button>
      <button class="tab" :class="{ active: tab === 'settings' }" @click="switchTab('settings')">系统设置</button>
    </div>

    <!-- 运行总览 -->
    <template v-if="tab === 'overview'">
      <div v-if="overviewLoading" class="loading-box"><div class="spinner"></div>加载中…</div>
      <template v-else-if="overview">
        <div class="stat-grid mb16">
          <div class="card stat-card">
            <div class="stat-value">{{ overview.goods_total }}</div>
            <div class="stat-label">在售商品</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{{ overview.tasks_online }}</div>
            <div class="stat-label">运行中监控任务</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{{ overview.triggers_today }}</div>
            <div class="stat-label">今日触发提醒</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{{ overview.users_total }}</div>
            <div class="stat-label">注册用户</div>
          </div>
        </div>

        <div class="card-title" style="margin:4px 0 12px">平台状态</div>
        <div class="plat-grid mb16">
          <div v-for="p in overview.platforms" :key="p.platform" class="card plat-card">
            <div class="plat-head">
              <span class="plat-name">{{ p.name }}</span>
              <label class="switch" :title="p.running ? '暂停同步' : '恢复同步'">
                <input type="checkbox" :checked="p.running" @change="togglePlatform(p)" />
                <span class="slider"></span>
              </label>
            </div>
            <div class="row" style="gap:6px">
              <span class="badge" :class="platStatusBadge(p.status)">{{ platStatusText(p.status) }}</span>
              <span class="badge" :class="p.running ? 'badge-primary' : 'badge-warning'">{{ p.running ? '同步中' : '已暂停' }}</span>
            </div>
            <div class="plat-stats">
              <span>累计 <b>{{ p.total_ok }}</b> 条</span>
              <span>上轮成功 <b>{{ p.last_ok }}</b></span>
              <span>失败 <b>{{ p.last_fail }}</b></span>
            </div>
            <div class="muted small">最近同步：{{ p.last_run ? fmtDateTime(p.last_run) : '尚未运行' }}</div>
          </div>
        </div>

        <div class="card-title" style="margin:4px 0 12px">最近同步记录</div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr><th>时间</th><th>平台</th><th>成功</th><th>失败</th><th>信息</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in overview.recent_logs" :key="l.id">
                <td class="muted">{{ fmtDateTime(l.created_at) }}</td>
                <td>{{ platformNameOf(l.platform) }}</td>
                <td style="color:var(--success)">{{ l.ok_count }}</td>
                <td :style="l.fail_count > 0 ? 'color:var(--danger)' : ''">{{ l.fail_count }}</td>
                <td class="muted">{{ l.message }}</td>
              </tr>
              <tr v-if="!overview.recent_logs.length">
                <td colspan="5"><EmptyState text="暂无同步记录" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <!-- 采集日志 -->
    <template v-else-if="tab === 'logs'">
      <div class="card card-pad mb16">
        <div class="row wrap" style="gap:10px">
          <span class="muted small">按平台筛选</span>
          <select v-model="logPlatform" class="select" style="width:180px" @change="switchLogPlatform">
            <option value="">全部平台</option>
            <option v-for="p in overview?.platforms || []" :key="p.platform" :value="p.platform">{{ p.name }}</option>
          </select>
        </div>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>时间</th><th>平台</th><th>成功</th><th>失败</th><th>信息</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td class="muted">{{ fmtDateTime(l.created_at) }}</td>
              <td>{{ platformNameOf(l.platform) }}</td>
              <td style="color:var(--success)">{{ l.ok_count }}</td>
              <td :style="l.fail_count > 0 ? 'color:var(--danger)' : ''">{{ l.fail_count }}</td>
              <td class="muted">{{ l.message }}</td>
            </tr>
            <tr v-if="!logs.length">
              <td colspan="5"><EmptyState text="暂无日志" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :page="logPage" :total="logTotal" :size="LOG_SIZE" @change="p => { logPage = p; loadLogs(); }" />
    </template>

    <!-- 游戏管理 -->
    <template v-else-if="tab === 'games'">
      <div class="row between mb16">
        <span class="muted small">共 {{ games.length }} 款游戏</span>
        <button class="btn btn-primary btn-sm" @click="openCreateGame">+ 添加游戏</button>
      </div>

      <div v-if="gamesLoading" class="loading-box"><div class="spinner"></div>加载中…</div>

      <div v-else class="card table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th><th>名称</th><th>简称</th><th>拼音</th><th>分类</th><th>标签</th>
              <th>状态</th><th>区服</th><th style="width:190px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in games" :key="g.id">
              <td class="muted">#{{ g.id }}</td>
              <td><b>{{ g.name }}</b></td>
              <td>{{ g.short_name }}</td>
              <td class="muted">{{ g.pinyin || '-' }}</td>
              <td><span class="badge" :class="g.category === '手游' ? 'badge-primary' : 'badge-warning'">{{ g.category }}</span></td>
              <td>
                <span v-for="t in g.tags" :key="t" class="badge" style="margin-right:4px">{{ t }}</span>
                <span v-if="!g.tags?.length" class="muted">-</span>
              </td>
              <td>
                <label class="switch" :title="g.status ? '停用' : '启用'">
                  <input type="checkbox" :checked="!!g.status" @change="toggleGameStatus(g)" />
                  <span class="slider"></span>
                </label>
              </td>
              <td>{{ g.servers?.length || 0 }} 个</td>
              <td>
                <div class="row" style="gap:6px">
                  <button class="btn btn-ghost btn-sm" @click="toggleExpand(g)">{{ expandedGame?.id === g.id ? '收起' : '区服' }}</button>
                  <button class="btn btn-ghost btn-sm" @click="openEditGame(g)">编辑</button>
                  <button class="btn btn-danger-ghost btn-sm" @click="deletingGame = g">删除</button>
                </div>
              </td>
            </tr>
            <!-- 区服管理展开行 -->
            <tr v-if="expandedGame" :key="`srv-${expandedGame.id}`">
              <td colspan="9" style="background:#fafbff">
                <div class="mb16" style="font-weight:700">{{ expandedGame.name }} · 区服列表</div>
                <div class="row wrap mb16" style="gap:8px">
                  <span v-for="s in expandedGame.servers" :key="s.id" class="badge badge-primary">
                    {{ s.name }}
                    <span class="muted small">（{{ s.type }}）</span>
                    <button
                      class="modal-close"
                      style="font-size:13px; padding:0 2px; margin-left:2px"
                      title="删除区服"
                      @click="removeServer(s)"
                    >&times;</button>
                  </span>
                  <span v-if="!expandedGame.servers?.length" class="muted small">暂无区服，同步引擎需要至少一个区服才能获取该游戏数据</span>
                </div>
                <div class="row wrap" style="gap:8px">
                  <input v-model="serverForm.name" class="input" placeholder="区服名称，如：官服-天空岛" style="width:220px" @keydown.enter="addServer(expandedGame)" />
                  <select v-model="serverForm.type" class="select" style="width:110px">
                    <option value="官服">官服</option>
                    <option value="渠道服">渠道服</option>
                  </select>
                  <button class="btn btn-primary btn-sm" @click="addServer(expandedGame)">添加区服</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 新建 / 编辑游戏 -->
      <Modal v-if="gameModal" :title="editingGame ? '编辑游戏' : '添加游戏'" @close="gameModal = false">
        <form @submit.prevent="saveGame">
          <div class="form-row form-item">
            <div>
              <label class="form-label">游戏名称<span class="req">*</span></label>
              <input v-model="gameForm.name" class="input" placeholder="如：原神" />
            </div>
            <div>
              <label class="form-label">简称</label>
              <input v-model="gameForm.short_name" class="input" placeholder="如：原神 / DNF" />
            </div>
          </div>
          <div class="form-row form-item">
            <div>
              <label class="form-label">拼音（用于搜索）</label>
              <input v-model="gameForm.pinyin" class="input" placeholder="如：yuanshen" />
            </div>
            <div>
              <label class="form-label">分类</label>
              <select v-model="gameForm.category" class="select">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>
          <div class="form-item">
            <label class="form-label">标签（逗号分隔）</label>
            <input v-model="gameForm.tags" class="input" placeholder="如：手游，二次元，网易" />
          </div>
        </form>
        <template #foot>
          <button class="btn btn-ghost" @click="gameModal = false">取消</button>
          <button class="btn btn-primary" :disabled="savingGame" @click="saveGame">{{ savingGame ? '保存中…' : '保存' }}</button>
        </template>
      </Modal>

      <!-- 删除游戏确认 -->
      <Modal v-if="deletingGame" title="删除游戏" @close="deletingGame = null">
        <p>
          确定删除游戏 <b>「{{ deletingGame?.name }}」</b> 及其全部区服吗？
          若该游戏下存在商品，将无法删除（可改为停用）。
        </p>
        <template #foot>
          <button class="btn btn-ghost" @click="deletingGame = null">取消</button>
          <button class="btn btn-danger" @click="doDeleteGame">确认删除</button>
        </template>
      </Modal>
    </template>

    <!-- 公告管理 -->
    <template v-else-if="tab === 'anns'">
      <div class="card card-pad mb16">
        <div class="card-title">发布公告</div>
        <div class="form-item">
          <label class="form-label">标题<span class="req">*</span></label>
          <input v-model="annForm.title" class="input" placeholder="公告标题" />
        </div>
        <div class="form-item">
          <label class="form-label">内容</label>
          <textarea v-model="annForm.content" class="textarea" placeholder="公告正文（展示在首页公告栏）"></textarea>
        </div>
        <button class="btn btn-primary" :disabled="posting" @click="postAnn">{{ posting ? '发布中…' : '发布公告' }}</button>
      </div>

      <div v-if="anns.length" class="card">
        <div v-for="a in anns" :key="a.id" class="announce-item">
          <div class="announce-title">
            <span class="badge badge-warning">公告</span>
            {{ a.title }}
            <span class="muted small" style="margin-left:auto">{{ fmtDateTime(a.created_at) }}</span>
            <button class="btn btn-danger-ghost btn-sm" style="margin-left:10px" @click="deletingAnn = a">删除</button>
          </div>
          <div class="announce-content">{{ a.content }}</div>
        </div>
      </div>
      <div v-else class="card"><EmptyState text="暂无公告" /></div>

      <Modal v-if="deletingAnn" title="删除公告" @close="deletingAnn = null">
        <p>确定删除公告 <b>「{{ deletingAnn?.title }}」</b> 吗？</p>
        <template #foot>
          <button class="btn btn-ghost" @click="deletingAnn = null">取消</button>
          <button class="btn btn-danger" @click="doDeleteAnn">确认删除</button>
        </template>
      </Modal>
    </template>

    <!-- 会员管理 -->
    <template v-else-if="tab === 'members'">
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>ID</th><th>用户</th><th>手机号</th><th>角色</th><th>会员状态</th><th>有效期至</th><th>已看商品</th><th>订阅单数</th><th style="width:110px">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in members" :key="u.id">
              <td class="muted">#{{ u.id }}</td>
              <td><b>{{ u.nickname || '-' }}</b></td>
              <td class="muted">{{ u.phone }}</td>
              <td><span v-if="u.is_admin" class="badge badge-warning">管理员</span><span v-else class="badge">用户</span></td>
              <td><span class="badge" :class="u.is_member ? 'badge-success' : 'badge-danger'">{{ u.is_member ? '会员' : '非会员' }}</span></td>
              <td class="muted">{{ u.is_member && u.member_expire_at ? fmtDateTime(u.member_expire_at) : '-' }}</td>
              <td>{{ u.view_count }}</td>
              <td>{{ u.member_orders }}</td>
              <td><button class="btn btn-primary btn-sm" @click="openGrant(u)">开通</button></td>
            </tr>
            <tr v-if="!members.length">
              <td colspan="9"><EmptyState text="暂无用户" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <Modal v-if="grantUser" title="手动开通会员" @close="grantUser = null">
        <p style="margin-bottom:12px">
          为用户 <b>{{ grantUser.nickname || grantUser.phone }}</b> 开通会员，有效期自当前起算（已有会员则顺延）。
        </p>
        <div class="form-item">
          <label class="form-label">开通天数</label>
          <input v-model="grantDays" class="input" type="number" min="1" placeholder="如：30" />
        </div>
        <template #foot>
          <button class="btn btn-ghost" :disabled="granting" @click="grantUser = null">取消</button>
          <button class="btn btn-primary" :disabled="granting" @click="submitGrant">{{ granting ? '开通中…' : '确认开通' }}</button>
        </template>
      </Modal>
    </template>

    <!-- 支付流水 -->
    <template v-else-if="tab === 'payorders'">
      <div class="card card-pad mb16">
        <div class="row wrap" style="gap:10px">
          <select v-model="payScene" class="select" style="width:150px" @change="loadPayOrders">
            <option value="">全部场景</option>
            <option value="member">会员订阅</option>
            <option value="auction">拍卖担保</option>
          </select>
          <select v-model="payStatus" class="select" style="width:150px" @change="loadPayOrders">
            <option value="">全部状态</option>
            <option value="pending">待支付</option>
            <option value="paid">支付成功</option>
            <option value="closed">已关闭</option>
            <option value="timeout">已超时</option>
          </select>
          <span class="muted small">共 {{ payOrders.length }} 笔</span>
        </div>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>支付单号</th><th>用户</th><th>场景</th><th>金额</th><th>渠道</th><th>状态</th><th>创建时间</th><th>支付时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="o in payOrders" :key="o.order_no">
              <td class="muted">{{ o.order_no }}</td>
              <td>{{ o.user_name || o.phone || `#${o.user_id}` }}</td>
              <td>{{ PAY_SCENE[o.scene] || o.scene }}</td>
              <td><b>{{ fmtPrice(o.amount) }}</b></td>
              <td class="muted">{{ CHANNEL_LABELS[o.channel] || o.channel || '-' }}</td>
              <td><span class="badge" :class="PAY_STATUS[o.status]?.badge">{{ PAY_STATUS[o.status]?.label || o.status }}</span></td>
              <td class="muted">{{ fmtDateTime(o.created_at) }}</td>
              <td class="muted">{{ o.paid_at ? fmtDateTime(o.paid_at) : '-' }}</td>
            </tr>
            <tr v-if="!payOrders.length">
              <td colspan="8"><EmptyState text="暂无支付订单" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 担保交易 -->
    <template v-else-if="tab === 'auctionorders'">
      <div class="card card-pad mb16">
        <div class="row wrap" style="gap:10px">
          <select v-model="aoStatus" class="select" style="width:170px" @change="loadAuctionOrders">
            <option value="">全部状态</option>
            <option value="pending_payment">待支付</option>
            <option value="pending_ship">待发货</option>
            <option value="pending_confirm">待确认收货</option>
            <option value="completed">交易完成</option>
            <option value="cancelled">已关闭</option>
            <option value="refunded">已退款</option>
            <option value="after_sale">售后中</option>
          </select>
          <span class="muted small">共 {{ auctionOrders.length }} 笔 · 「待发货 / 待确认收货 / 售后中」订单金额处于平台担保中</span>
        </div>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>ID</th><th>拍卖标的</th><th>买家</th><th>卖家</th><th>金额</th><th>状态</th><th>物流</th><th>支付单号</th><th>下单时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="o in auctionOrders" :key="o.id">
              <td class="muted">#{{ o.id }}</td>
              <td><b>{{ o.auction_title }}</b></td>
              <td>{{ o.buyer_name }}</td>
              <td>{{ o.seller_name }}</td>
              <td>
                <b>{{ fmtPrice(o.amount) }}</b>
                <div v-if="['pending_ship','pending_confirm','after_sale'].includes(o.status)" class="muted small">担保中</div>
              </td>
              <td><span class="badge" :class="ORDER_STATUS[o.status]?.badge">{{ ORDER_STATUS[o.status]?.label || o.status }}</span></td>
              <td class="muted">
                <template v-if="o.ship_company">{{ o.ship_company }} {{ o.ship_no }}</template>
                <template v-else>-</template>
              </td>
              <td class="muted">{{ o.pay_order_no || '-' }}</td>
              <td class="muted">{{ fmtDateTime(o.created_at) }}</td>
            </tr>
            <tr v-if="!auctionOrders.length">
              <td colspan="9"><EmptyState text="暂无担保交易订单" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 提现审核 -->
    <template v-else-if="tab === 'withdraws'">
      <div class="card card-pad mb16">
        <div class="row wrap" style="gap:10px">
          <select v-model="wdStatus" class="select" style="width:150px" @change="loadWithdraws">
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="paid">提现成功</option>
            <option value="rejected">已驳回</option>
          </select>
          <span class="muted small">共 {{ withdrawList.length }} 笔</span>
        </div>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>ID</th><th>用户</th><th>金额</th><th>手续费</th><th>实付</th><th>渠道 / 账户</th><th>状态</th><th>申请时间</th><th>备注</th><th style="width:150px">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="w in withdrawList" :key="w.id">
              <td class="muted">#{{ w.id }}</td>
              <td>{{ w.user_name || w.phone || `#${w.user_id}` }}</td>
              <td><b>{{ fmtPrice(w.amount) }}</b></td>
              <td class="muted">{{ fmtPrice(w.fee) }}</td>
              <td><b style="color:var(--success)">{{ fmtPrice(w.amount - w.fee) }}</b></td>
              <td class="muted">{{ CHANNEL_LABELS[w.channel] || w.channel }} / {{ w.account }}</td>
              <td><span class="badge" :class="WITHDRAW_STATUS[w.status]?.badge">{{ WITHDRAW_STATUS[w.status]?.label || w.status }}</span></td>
              <td class="muted">{{ fmtDateTime(w.created_at) }}</td>
              <td class="muted">{{ w.remark || '-' }}</td>
              <td>
                <div v-if="w.status === 'pending'" class="row" style="gap:6px">
                  <button class="btn btn-primary btn-sm" @click="openWdAction(w, 'approve')">通过</button>
                  <button class="btn btn-danger-ghost btn-sm" @click="openWdAction(w, 'reject')">驳回</button>
                </div>
                <span v-else class="muted small">已处理</span>
              </td>
            </tr>
            <tr v-if="!withdrawList.length">
              <td colspan="10"><EmptyState text="暂无提现申请" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <Modal v-if="wdAction" :title="wdAction.action === 'approve' ? '通过提现' : '驳回提现'" @close="wdAction = null">
        <p style="margin-bottom:12px">
          <template v-if="wdAction.action === 'approve'">
            确认向 <b>{{ wdAction.w.user_name || wdAction.w.phone }}</b> 打款
            <b style="color:var(--success)">{{ fmtPrice(wdAction.w.amount - wdAction.w.fee) }}</b>
            （{{ CHANNEL_LABELS[wdAction.w.channel] }} / {{ wdAction.w.account }}）？
          </template>
          <template v-else>
            确认驳回 <b>{{ wdAction.w.user_name || wdAction.w.phone }}</b> 的提现申请
            <b>{{ fmtPrice(wdAction.w.amount) }}</b> 吗？驳回后资金将退回用户余额。
          </template>
        </p>
        <div class="form-item">
          <label class="form-label">备注（可选）</label>
          <input v-model="wdRemark" class="input" placeholder="如：已线下打款 / 账户信息有误" />
        </div>
        <template #foot>
          <button class="btn btn-ghost" :disabled="wdSubmitting" @click="wdAction = null">取消</button>
          <button
            class="btn"
            :class="wdAction.action === 'approve' ? 'btn-primary' : 'btn-danger'"
            :disabled="wdSubmitting"
            @click="submitWdAction"
          >{{ wdSubmitting ? '处理中…' : '确认' }}</button>
        </template>
      </Modal>
    </template>

    <!-- 资金流水 -->
    <template v-else-if="tab === 'fundlogs'">
      <div class="card card-pad mb16">
        <div class="row wrap" style="gap:10px">
          <select v-model="fundBiz" class="select" style="width:170px" @change="loadFundLogs">
            <option value="">全部类型</option>
            <option v-for="(label, key) in BIZ_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
          <span class="muted small">共 {{ fundLogs.length }} 条</span>
        </div>
      </div>
      <div class="card table-wrap">
        <table class="table">
          <thead>
            <tr><th>时间</th><th>用户</th><th>类型</th><th>金额</th><th>渠道</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in fundLogs" :key="l.id">
              <td class="muted">{{ fmtDateTime(l.created_at) }}</td>
              <td>{{ l.user_name || l.phone || `#${l.user_id}` }}</td>
              <td>{{ bizLabel(l.biz) }}</td>
              <td>
                <b :style="l.direction === 'in' ? 'color:var(--success)' : 'color:var(--danger)'">
                  {{ l.direction === 'in' ? '+' : '-' }}{{ fmtPrice(l.amount) }}
                </b>
              </td>
              <td class="muted">{{ CHANNEL_LABELS[l.channel] || l.channel || '-' }}</td>
              <td class="muted">{{ l.remark || '-' }}</td>
            </tr>
            <tr v-if="!fundLogs.length">
              <td colspan="6"><EmptyState text="暂无资金流水" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 系统设置 -->
    <template v-else-if="tab === 'settings'">
      <div class="card card-pad">
        <div class="card-title">平台参数配置</div>
        <div class="muted small" style="margin-bottom:14px">修改后即时生效，影响会员权益、免费限额、担保交易与提现规则</div>
        <div v-for="s in settingsList" :key="s.key" class="form-item">
          <label class="form-label">{{ s.label }}</label>
          <select v-if="s.key === 'view_count_mode'" v-model="settingsEdit[s.key]" class="select" style="max-width:320px">
            <option value="permanent">永久累计</option>
            <option value="daily">每日重置</option>
          </select>
          <input v-else v-model="settingsEdit[s.key]" class="input" style="max-width:320px" />
          <div class="form-hint muted small">{{ s.key }}</div>
        </div>
        <div v-if="!settingsList.length"><EmptyState text="暂无配置项" /></div>
        <button v-if="settingsList.length" class="btn btn-primary" :disabled="savingSettings" @click="saveSettings">
          {{ savingSettings ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </template>
  </main>
</template>
