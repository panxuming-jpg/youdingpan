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

function switchTab(key) {
  tab.value = key;
  if (key === 'overview') loadOverview();
  else if (key === 'logs') loadLogs();
  else if (key === 'games') loadGames();
  else if (key === 'anns') loadAnns();
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

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="switchTab('overview')">运行总览</button>
      <button class="tab" :class="{ active: tab === 'logs' }" @click="switchTab('logs')">同步日志</button>
      <button class="tab" :class="{ active: tab === 'games' }" @click="switchTab('games')">游戏管理</button>
      <button class="tab" :class="{ active: tab === 'anns' }" @click="switchTab('anns')">公告管理</button>
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
  </main>
</template>
