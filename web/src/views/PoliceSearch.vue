<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { fmtDateTime } from '../utils.js';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';

const districts = ref([]);
const form = ref({ province: '', city: '', district: '', keyword: '' });
const results = ref(null);
const searching = ref(false);

const cityOptions = computed(() =>
  districts.value.find(p => p.province === form.value.province)?.cities || []);
const districtOptions = computed(() =>
  cityOptions.value.find(x => x.city === form.value.city)?.districts || []);

async function search() {
  searching.value = true;
  try {
    results.value = await api('/police/search', {
      query: {
        province: form.value.province, city: form.value.city,
        district: form.value.district, keyword: form.value.keyword, limit: 50,
      },
    });
  } catch (e) {
    toast.error(e.message);
  } finally {
    searching.value = false;
  }
}

function resetFilter() {
  form.value = { province: '', city: '', district: '', keyword: '' };
  search();
}

// ---------- 详情弹窗 ----------
const detail = ref(null);
const issue = ref('');
const fbSubmitting = ref(false);

function openDetail(s) {
  detail.value = s;
  issue.value = '';
}

async function copyText(text, label) {
  if (!text) return toast.error('该信息暂缺，无法复制');
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}已复制`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast.success(`${label}已复制`);
  }
}

async function submitFeedback() {
  if (!store.token) return toast.error('请先登录后提交纠错反馈');
  const text = issue.value.trim();
  if (!text) return toast.error('请填写纠错内容');
  fbSubmitting.value = true;
  try {
    await api(`/police/${detail.value.id}/feedback`, { method: 'POST', body: { issue: text } });
    toast.success('纠错反馈已提交，感谢帮助完善追回指引');
    issue.value = '';
  } catch (e) {
    toast.error(e.message);
  } finally {
    fbSubmitting.value = false;
  }
}

// ---------- 实时补充查询（高德 POI，仅展示不落库） ----------
const mode = ref('db'); // db=官方数据库 | realtime=高德实时
const rt = ref({ city: '', keyword: '派出所', page: 1 });
const rtEnabled = ref(true);
const rtResult = ref(null); // { list, count, source }
const rtSearching = ref(false);

async function loadRtStatus() {
  try { rtEnabled.value = (await api('/police/realtime-status')).enabled; } catch { rtEnabled.value = false; }
}

async function rtSearch() {
  rtSearching.value = true;
  try {
    rtResult.value = await api('/police/realtime', {
      query: { city: rt.value.city, keyword: rt.value.keyword || '派出所', page: rt.value.page },
    });
  } catch (e) {
    toast.error(e.message);
    rtResult.value = null;
  } finally {
    rtSearching.value = false;
  }
}

async function switchMode(m) {
  mode.value = m;
  if (m === 'realtime' && !rtResult.value) {
    if (!rt.value.city) rt.value.city = form.value.city || form.value.province;
    await loadRtStatus();
    if (rtEnabled.value) rtSearch();
  }
}

onMounted(async () => {
  try {
    districts.value = await api('/police/districts');
  } catch (e) {
    toast.error(e.message);
  }
  search();
});
</script>

<template>
  <main class="container page">
    <div class="page-title">派出所检索 · 追回指引</div>
    <div class="page-sub">被找回账号涉诈或需报案时，就近选择公安机关派出所递交报案材料（信息为演示数据，以官方公布为准）</div>

    <div class="card card-pad mb16" style="border-color:var(--primary); background:var(--primary-weak)">
      <div class="row wrap" style="gap:14px; font-size:13px">
        <span>ℹ️ 公安机关<b>报案不收取任何费用</b>，凡以「办案费/保证金」名义要求转账的都是诈骗</span>
        <span>📞 涉电信网络诈骗咨询/举报：<b>96110</b>（反诈专线）</span>
        <span>🚨 紧急情况请直接拨打 <b>110</b></span>
      </div>
    </div>

    <div class="row mb16" style="gap:8px">
      <button class="chip" :class="{ active: mode === 'db' }" @click="switchMode('db')">官方数据库检索</button>
      <button class="chip" :class="{ active: mode === 'realtime' }" @click="switchMode('realtime')">实时补充查询（高德地图）</button>
    </div>

    <div v-if="mode === 'db'" class="card card-pad mb16">
      <div class="form-row">
        <div class="form-item" style="margin-bottom:0">
          <label class="form-label">省</label>
          <select v-model="form.province" class="select" @change="form.city = ''; form.district = ''">
            <option value="">全部</option>
            <option v-for="p in districts" :key="p.province" :value="p.province">{{ p.province }}</option>
          </select>
        </div>
        <div class="form-item" style="margin-bottom:0">
          <label class="form-label">市</label>
          <select v-model="form.city" class="select" :disabled="!form.province" @change="form.district = ''">
            <option value="">全部</option>
            <option v-for="x in cityOptions" :key="x.city" :value="x.city">{{ x.city }}</option>
          </select>
        </div>
        <div class="form-item" style="margin-bottom:0">
          <label class="form-label">区</label>
          <select v-model="form.district" class="select" :disabled="!form.city">
            <option value="">全部</option>
            <option v-for="d in districtOptions" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="form-item" style="margin-bottom:0">
          <label class="form-label">关键词</label>
          <input v-model="form.keyword" class="input" maxlength="30" placeholder="派出所名称 / 地址关键词" @keydown.enter.prevent="search" />
        </div>
      </div>
      <div class="row mt16" style="gap:10px">
        <button class="btn btn-primary" :disabled="searching" @click="search">{{ searching ? '检索中…' : '检索' }}</button>
        <button class="btn btn-ghost" @click="resetFilter">重置</button>
        <span v-if="results" class="muted small">共 {{ results.length }} 个结果</span>
      </div>
    </div>

    <div v-if="mode === 'db' && searching && !results" class="loading-box"><div class="spinner"></div>检索中…</div>

    <div v-else-if="mode === 'db' && results && results.length" class="goods-grid">
      <div v-for="s in results" :key="s.id" class="goods-card" @click="openDetail(s)">
        <div class="goods-top">
          <span class="badge badge-primary">{{ [s.province, s.district].filter(Boolean).join(' · ') || '—' }}</span>
          <span v-if="s.stale" class="badge badge-warning">待核实</span>
          <span v-if="s.distance_km != null" class="badge badge-success">{{ s.distance_km }} km</span>
        </div>
        <div class="goods-title" style="min-height:auto">{{ s.name }}</div>
        <div class="muted small">📍 {{ s.address || '地址待核实' }}</div>
        <div class="muted small">☎️ {{ s.phone || '以 110 转接为准' }}</div>
        <div class="goods-bottom">
          <span class="goods-meta">{{ s.hours || '' }}</span>
          <span class="muted small">点击查看详情 →</span>
        </div>
        <div class="muted small" style="opacity:.7">{{ s.source }}</div>
      </div>
    </div>

    <div v-else-if="mode === 'db' && results" class="card">
      <EmptyState text="未检索到符合条件的派出所，请调整筛选或关键词" icon="🔍" />
    </div>

    <!-- ===== 实时补充查询（高德）：结果仅展示、不落库 ===== -->
    <template v-if="mode === 'realtime'">
      <div v-if="!rtEnabled" class="card card-pad mb16" style="border-color:var(--warning)">
        <div class="small">🔑 <b>实时补充查询未启用</b></div>
        <div class="muted small mt8">管理员可在「管理后台 → 安全交易管理 → 派出所数据」中填写高德 Web 服务 Key（在 <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener">高德开放平台控制台</a> 免费申请，服务平台选「Web服务」），或为服务端配置环境变量 <code>AMAP_KEY</code>。官方数据库检索不受影响。</div>
      </div>
      <div v-else class="card card-pad mb16">
        <div class="form-row">
          <div class="form-item" style="margin-bottom:0">
            <label class="form-label">城市</label>
            <input v-model="rt.city" class="input" maxlength="20" placeholder="如：北京（留空则全国）" @keydown.enter.prevent="rtSearch" />
          </div>
          <div class="form-item" style="margin-bottom:0">
            <label class="form-label">关键词</label>
            <input v-model="rt.keyword" class="input" maxlength="30" placeholder="派出所" @keydown.enter.prevent="rtSearch" />
          </div>
        </div>
        <div class="row mt16" style="gap:10px">
          <button class="btn btn-primary" :disabled="rtSearching" @click="rtSearch">{{ rtSearching ? '查询中…' : '实时查询' }}</button>
          <span v-if="rtResult" class="muted small">约 {{ rtResult.count }} 条，本页 {{ rtResult.list.length }} 条</span>
        </div>
      </div>

      <div v-if="rtEnabled && rtSearching && !rtResult" class="loading-box"><div class="spinner"></div>高德查询中…</div>

      <template v-else-if="rtEnabled && rtResult">
        <div class="goods-grid">
          <div v-for="(p, i) in rtResult.list" :key="i" class="goods-card">
            <div class="goods-top">
              <span class="badge badge-primary">{{ p.district || '—' }}</span>
              <span class="badge">高德实时</span>
            </div>
            <div class="goods-title" style="min-height:auto">{{ p.name }}</div>
            <div class="muted small">📍 {{ p.address || '地址见地图' }}</div>
            <div class="muted small">☎️ {{ p.tel || '以 110 转接为准' }}</div>
            <div class="goods-bottom">
              <a v-if="p.amap_link" class="btn btn-ghost btn-sm" :href="p.amap_link" target="_blank" rel="noopener">在高德地图查看</a>
              <span class="muted small">不落库 · 仅供参考</span>
            </div>
          </div>
        </div>
        <div class="muted small mt16">{{ rtResult.source }}</div>
      </template>
    </template>

    <!-- ===== 详情弹窗 ===== -->
    <Modal v-if="detail" :title="detail.name" wide @close="detail = null">
      <dl class="kv-list" style="grid-template-columns:96px 1fr">
        <dt>所属地区</dt><dd>{{ [detail.province, detail.city, detail.district].filter(Boolean).join(' / ') }}</dd>
        <dt>地址</dt>
        <dd>
          {{ detail.address || '待核实' }}
          <button v-if="detail.address" class="btn btn-ghost btn-sm" style="margin-left:8px" @click="copyText(detail.address, '地址')">复制地址</button>
        </dd>
        <dt>联系电话</dt>
        <dd>
          {{ detail.phone || '以 110 转接为准' }}
          <button v-if="detail.phone" class="btn btn-ghost btn-sm" style="margin-left:8px" @click="copyText(detail.phone, '电话')">复制电话</button>
        </dd>
        <dt>负责民警</dt><dd>{{ detail.officer || '—' }}</dd>
        <dt>警号</dt><dd>{{ detail.officer_badge || '—' }}</dd>
        <dt>管辖范围</dt><dd>{{ detail.jurisdiction || '—' }}</dd>
        <dt>接待时间</dt><dd>{{ detail.hours || '—' }}</dd>
        <dt>信息来源</dt><dd class="muted small">{{ detail.source }}（更新于 {{ fmtDateTime(detail.updated_at) }}）</dd>
      </dl>
      <div v-if="detail.stale" class="small mt8" style="color:var(--warning)">⚠ 该信息超过 12 个月未核实，前往前建议电话确认。</div>
      <div class="form-item mt16">
        <label class="form-label">信息有误？提交纠错反馈</label>
        <textarea v-model="issue" class="textarea" rows="2" maxlength="500" placeholder="例：地址已搬迁，新地址为……（登录后可提交，运营核实后修正）"></textarea>
      </div>
      <template #foot>
        <button class="btn btn-ghost" @click="detail = null">关闭</button>
        <button class="btn btn-primary" :disabled="fbSubmitting || !issue.trim()" @click="submitFeedback">{{ fbSubmitting ? '提交中…' : '提交纠错' }}</button>
      </template>
    </Modal>
  </main>
</template>
