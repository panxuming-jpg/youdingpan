<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, getToken } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';

const router = useRouter();

const tab = ref('entry'); // entry 入驻 | publish 发布 | goods 我的商品
const status = ref(null); // GET /seller/status
const templates = ref([]); // GET /seller/templates
const statusLoading = ref(false);

const PROOF_TYPES = [
  { key: 'register_page', label: '注册页截图' },
  { key: 'first_bill', label: '首充记录' },
  { key: 'realname_page', label: '实名信息页' },
  { key: 'device_shot', label: '设备登录截图' },
];

const sellerStatusMap = {
  '': { label: '未入驻', badge: 'badge' },
  pending: { label: '资质审核中', badge: 'badge-warning' },
  approved: { label: '已获卖家资质', badge: 'badge-success' },
  rejected: { label: '资质被驳回', badge: 'badge-danger' },
};
const proofStatusMap = {
  pending: { label: '审核中', badge: 'badge-warning' },
  approved: { label: '已通过', badge: 'badge-success' },
  rejected: { label: '已驳回', badge: 'badge-danger' },
};
const listingStatusMap = {
  pending: { label: '审核中', badge: 'badge-warning' },
  review: { label: '复审中', badge: 'badge-warning' },
  on: { label: '在售', badge: 'badge-success' },
  locked: { label: '已锁定（交易中）', badge: 'badge-primary' },
  offline: { label: '已下架', badge: 'badge' },
  rejected: { label: '审核驳回', badge: 'badge-danger' },
  sold: { label: '已售出', badge: 'badge-primary' },
};
const CONF_LABEL = { high: '高', mid: '中', low: '低' };

const isApproved = computed(() => status.value?.seller_status === 'approved');
const isBanned = computed(() => (status.value?.ban_until || 0) > Date.now());

// ---------- 实名认证 ----------
const realForm = ref({ real_name: '', id_card: '' });
const realSubmitting = ref(false);

async function submitRealname() {
  const name = realForm.value.real_name.trim();
  const idc = realForm.value.id_card.trim();
  if (name.length < 2) return toast.error('请填写真实姓名');
  if (!/^\d{17}[\dXx]$/.test(idc)) return toast.error('身份证号格式不正确（18 位）');
  realSubmitting.value = true;
  try {
    await api('/seller/realname', { method: 'POST', body: { real_name: name, id_card: idc } });
    toast.success('实名认证成功');
    realForm.value = { real_name: '', id_card: '' };
    await loadStatus();
  } catch (e) {
    toast.error(e.message);
  } finally {
    realSubmitting.value = false;
  }
}

// ---------- 卖家资质（归属凭证） ----------
const proofForm = ref({ game_id: '', type: 'register_page', images: [] });
const proofUploading = ref(false);
const proofSubmitting = ref(false);

const proofGames = computed(() => templates.value);

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: fd,
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '上传失败');
  return j.data.url;
}

async function onProofFileChange(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const remain = 9 - proofForm.value.images.length;
  if (remain <= 0) { toast.error('凭证截图最多 9 张'); e.target.value = ''; return; }
  proofUploading.value = true;
  let ok = 0;
  for (const f of files.slice(0, remain)) {
    if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} 超过 5MB`); continue; }
    try {
      proofForm.value.images.push(await uploadImage(f));
      ok++;
    } catch (err) {
      toast.error(`${f.name} 上传失败：${err.message}`);
    }
  }
  proofUploading.value = false;
  e.target.value = '';
  if (ok) toast.success(`已上传 ${ok} 张凭证截图`);
}

async function submitProof() {
  const f = proofForm.value;
  if (!f.game_id) return toast.error('请选择游戏');
  if (!f.images.length) return toast.error('请上传至少 1 张归属凭证截图');
  proofSubmitting.value = true;
  try {
    await api('/seller/proof', {
      method: 'POST',
      body: { game_id: Number(f.game_id), type: f.type, images: f.images },
    });
    toast.success('资质申请已提交，等待运营审核');
    proofForm.value = { game_id: '', type: 'register_page', images: [] };
    await loadStatus();
  } catch (e) {
    toast.error(e.message);
  } finally {
    proofSubmitting.value = false;
  }
}

// ---------- 发布向导 ----------
const step = ref(1); // 1 填写信息 2 上传截图 3 提交审核 4 生成图/估值
const STEPS = ['填写账号信息', '上传原始截图', '提交审核', '生成展示图与估值'];
const form = ref({
  game_id: '',
  server_name: '',
  channel: '',
  account_id: '',
  price: '',
  support_compensation: true,
  description: '',
  assets: {},
});
const rawImages = ref([]);
const rawUploading = ref(false);
const submitting = ref(false);
const createdId = ref(0);
const genImages = ref([]);
const genLoading = ref(false);
const valuation = ref(null);
let pollTimer = null;

const MAX_RAW = 15;
const MIN_RAW = 3;

const selectedGame = computed(() => templates.value.find(g => g.id === Number(form.value.game_id)));
const serverOptions = computed(() => selectedGame.value?.servers || []);
const assetTemplate = computed(() => selectedGame.value?.asset_template || []);

watch(() => form.value.game_id, () => {
  const next = {};
  for (const t of assetTemplate.value) next[t.key] = '';
  form.value.assets = next;
  form.value.server_name = '';
});

async function onRawFileChange(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const remain = MAX_RAW - rawImages.value.length;
  if (remain <= 0) { toast.error(`原始截图最多 ${MAX_RAW} 张`); e.target.value = ''; return; }
  rawUploading.value = true;
  let ok = 0;
  for (const f of files.slice(0, remain)) {
    if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} 超过 5MB`); continue; }
    try {
      rawImages.value.push(await uploadImage(f));
      ok++;
    } catch (err) {
      toast.error(`${f.name} 上传失败：${err.message}`);
    }
  }
  rawUploading.value = false;
  e.target.value = '';
  if (ok) toast.success(`已上传 ${ok} 张截图`);
}

function removeRaw(idx) { rawImages.value.splice(idx, 1); }

function validateStep1() {
  const f = form.value;
  if (!f.game_id) return (toast.error('请选择游戏'), false);
  if (!f.server_name.trim()) return (toast.error('请选择或填写区服'), false);
  if (!f.account_id.trim()) return (toast.error('请填写账号标识（展示时自动脱敏）'), false);
  const p = Number(f.price);
  if (!Number.isFinite(p) || p < 1) return (toast.error('售价须 ≥ 1 元'), false);
  const empty = assetTemplate.value.find(t => String(f.assets[t.key] ?? '').trim() === '');
  if (empty) return (toast.error(`请填写资产字段「${empty.label}」`), false);
  return true;
}

function nextStep() {
  if (step.value === 1) {
    if (!validateStep1()) return;
    step.value = 2;
  } else if (step.value === 2) {
    if (rawImages.value.length < MIN_RAW) return toast.error(`原始截图至少 ${MIN_RAW} 张`);
    step.value = 3;
  }
}

function prevStep() {
  if (step.value > 1 && step.value < 4) step.value--;
}

async function submitListing() {
  const f = form.value;
  if (!isApproved.value) { toast.error('请先在「卖家入驻」完成实名与归属凭证审核'); tab.value = 'entry'; return; }
  if (isBanned.value) return toast.error(`发布入口已暂停至 ${fmtDateTime(status.value.ban_until)}`);
  const assets = {};
  for (const t of assetTemplate.value) {
    const v = String(f.assets[t.key] ?? '').trim();
    assets[t.key] = t.type === 'number' ? Number(v) : v;
  }
  submitting.value = true;
  try {
    const res = await api('/listings', {
      method: 'POST',
      body: {
        game_id: Number(f.game_id),
        server_name: f.server_name.trim(),
        channel: f.channel,
        account_id: f.account_id.trim(),
        assets,
        raw_images: rawImages.value,
        price: Number(f.price),
        support_compensation: f.support_compensation,
        description: f.description.trim(),
      },
    });
    createdId.value = res.id;
    toast.success(`商品 #${res.id} 已提交审核`);
    step.value = 4;
    startValuationPoll();
  } catch (e) {
    toast.error(e.message);
  } finally {
    submitting.value = false;
  }
}

async function generateImages() {
  if (!createdId.value) return;
  genLoading.value = true;
  try {
    const res = await api(`/listings/${createdId.value}/generate-images`, { method: 'POST' });
    genImages.value = res.images || [];
    toast.success(`已生成 ${genImages.value.length} 张标准化展示图`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    genLoading.value = false;
  }
}

// 估值由审核通过后服务端自动生成；此处轮询「我的商品」拉取估值区间
function startValuationPoll() {
  stopValuationPoll();
  pollTimer = setInterval(async () => {
    try {
      const rows = await api('/listings/mine');
      const l = rows.find(x => x.id === createdId.value);
      if (l?.valuation) {
        valuation.value = l.valuation;
        stopValuationPoll();
      }
    } catch { /* 静默重试 */ }
  }, 8000);
}
function stopValuationPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
async function refreshValuation() {
  try {
    const rows = await api('/listings/mine');
    const l = rows.find(x => x.id === createdId.value);
    valuation.value = l?.valuation || null;
    if (!valuation.value) toast.info('估值将在审核通过后自动生成');
  } catch (e) {
    toast.error(e.message);
  }
}

function resetWizard() {
  stopValuationPoll();
  step.value = 1;
  createdId.value = 0;
  genImages.value = [];
  valuation.value = null;
  rawImages.value = [];
  form.value = {
    game_id: '', server_name: '', channel: '', account_id: '',
    price: '', support_compensation: true, description: '', assets: {},
  };
}

watch(step, s => { if (s !== 4) stopValuationPoll(); else if (createdId.value && !valuation.value) startValuationPoll(); });

// ---------- 我的商品 ----------
const goods = ref([]);
const goodsLoading = ref(false);
const editTarget = ref(null);
const editForm = ref({ price: '', description: '', support_compensation: true });
const editSaving = ref(false);

async function loadGoods() {
  goodsLoading.value = true;
  try {
    goods.value = await api('/listings/mine');
  } catch (e) {
    toast.error(e.message);
  } finally {
    goodsLoading.value = false;
  }
}

async function offlineListing(l) {
  if (!confirm(`确认下架商品 #${l.id}（${l.game_name} · ${l.server_name}）吗？`)) return;
  try {
    await api(`/listings/${l.id}/offline`, { method: 'POST' });
    toast.success('已下架');
    loadGoods();
  } catch (e) {
    toast.error(e.message);
  }
}

function openEdit(l) {
  editTarget.value = l;
  editForm.value = {
    price: String(l.price),
    description: l.description || '',
    support_compensation: !!l.support_compensation,
  };
}

async function saveEdit() {
  const l = editTarget.value;
  if (!l) return;
  const p = Number(editForm.value.price);
  if (!Number.isFinite(p) || p < 1) return toast.error('售价须 ≥ 1 元');
  editSaving.value = true;
  try {
    await api(`/listings/${l.id}`, {
      method: 'PUT',
      body: {
        price: p,
        description: editForm.value.description.trim(),
        support_compensation: editForm.value.support_compensation,
      },
    });
    toast.success(l.status === 'rejected' ? '已修改并重新提交审核' : '已保存修改');
    editTarget.value = null;
    loadGoods();
  } catch (e) {
    toast.error(e.message);
  } finally {
    editSaving.value = false;
  }
}

function switchTab(k) {
  tab.value = k;
  if (k === 'goods') loadGoods();
}

// ---------- 加载 ----------
async function loadStatus() {
  statusLoading.value = true;
  try {
    status.value = await api('/seller/status');
  } catch (e) {
    toast.error(e.message);
  } finally {
    statusLoading.value = false;
  }
}

onMounted(async () => {
  if (!store.token) {
    router.push({ path: '/login', query: { redirect: '/seller' } });
    return;
  }
  try {
    templates.value = await api('/seller/templates');
  } catch { /* 静默 */ }
  loadStatus();
});

onUnmounted(stopValuationPoll);
</script>

<template>
  <main class="container page">
    <div class="page-title">卖家中心</div>
    <div class="page-sub">实名认证 → 提交归属凭证获得卖家资质 → 发布自营商品 → 管理在售商品</div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'entry' }" @click="switchTab('entry')">卖家入驻</button>
      <button class="tab" :class="{ active: tab === 'publish' }" @click="switchTab('publish')">发布商品</button>
      <button class="tab" :class="{ active: tab === 'goods' }" @click="switchTab('goods')">我的商品</button>
    </div>

    <!-- ================= 卖家入驻 ================= -->
    <template v-if="tab === 'entry'">
      <div v-if="statusLoading && !status" class="loading-box"><div class="spinner"></div>加载中…</div>

      <!-- 实名认证 -->
      <div class="card card-pad mb16">
        <div class="row between wrap" style="margin-bottom:10px">
          <div class="card-title" style="margin:0">① 实名认证</div>
          <span v-if="status?.face_verified" class="badge badge-success">已实名 · 人脸核验通过</span>
          <span v-else class="badge badge-warning">未实名</span>
        </div>
        <dl v-if="status?.face_verified" class="kv-list">
          <dt>真实姓名</dt><dd>{{ status.real_name }}</dd>
          <dt>身份证号</dt><dd>{{ status.id_card_mask }}</dd>
        </dl>
        <template v-else>
          <p class="muted small mb16">下单与发布商品均需实名认证。请填写本人真实姓名与 18 位身份证号（演示环境模拟人脸核验）。</p>
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">真实姓名 <span class="req">*</span></label>
              <input v-model="realForm.real_name" class="input" maxlength="20" placeholder="与身份证一致" />
            </div>
            <div class="form-item">
              <label class="form-label">身份证号 <span class="req">*</span></label>
              <input v-model="realForm.id_card" class="input" maxlength="18" placeholder="18 位身份证号" />
            </div>
          </div>
          <button class="btn btn-primary" :disabled="realSubmitting" @click="submitRealname">
            {{ realSubmitting ? '提交中…' : '提交实名认证' }}
          </button>
        </template>
      </div>

      <!-- 卖家资质 -->
      <div class="card card-pad">
        <div class="row between wrap" style="margin-bottom:10px">
          <div class="card-title" style="margin:0">② 卖家资质（账号归属凭证）</div>
          <span v-if="status" class="badge" :class="sellerStatusMap[status.seller_status || ''].badge">
            {{ sellerStatusMap[status.seller_status || ''].label }}
          </span>
        </div>
        <p v-if="status?.seller_status === 'pending'" class="muted small mb16">资质申请审核中，运营通过后将开通发布商品权限。</p>
        <p v-if="status?.seller_status === 'rejected'" class="small mb16" style="color:var(--danger)">
          驳回原因：{{ status.reject_reason || '凭证不符合要求' }}。可修改后重新提交，不限次数。
        </p>
        <p v-if="isBanned" class="small mb16" style="color:var(--warning)">
          ⚠ 因 24 小时内多次审核驳回，发布入口已暂停至 {{ fmtDateTime(status.ban_until) }}
        </p>
        <p v-if="isApproved" class="small mb16" style="color:var(--success)">✔ 您已获得卖家资质，可前往「发布商品」上传账号。</p>

        <!-- 资质申请表单 -->
        <template v-if="status && !isApproved && status.seller_status !== 'pending'">
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">游戏 <span class="req">*</span></label>
              <select v-model="proofForm.game_id" class="select">
                <option value="">请选择游戏</option>
                <option v-for="g in proofGames" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </div>
            <div class="form-item">
              <label class="form-label">凭证类型 <span class="req">*</span></label>
              <select v-model="proofForm.type" class="select">
                <option v-for="t in PROOF_TYPES" :key="t.key" :value="t.key">{{ t.label }}</option>
              </select>
            </div>
          </div>
          <div class="form-item">
            <label class="form-label">凭证截图（最多 9 张）</label>
            <div class="img-grid">
              <div v-for="(img, idx) in proofForm.images" :key="img" class="img-ph img-ph-link" style="position:relative">
                <img :src="img" alt="凭证" />
                <button class="btn btn-sm btn-ghost" style="position:absolute;top:4px;right:4px" @click="proofForm.images.splice(idx, 1)">×</button>
              </div>
              <label class="img-ph" style="cursor:pointer">
                <input type="file" accept="image/*" multiple hidden :disabled="proofUploading" @change="onProofFileChange" />
                <span v-if="proofUploading">上传中…</span>
                <span v-else>+ 上传截图</span>
              </label>
            </div>
          </div>
          <button class="btn btn-primary" :disabled="proofSubmitting" @click="submitProof">
            {{ proofSubmitting ? '提交中…' : '提交资质申请' }}
          </button>
        </template>

        <!-- 凭证记录 -->
        <div v-if="status?.proofs?.length" class="mt16">
          <div class="card-title">凭证提交记录</div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>游戏</th><th>类型</th><th>截图</th><th>状态</th><th>说明</th><th>时间</th></tr></thead>
              <tbody>
                <tr v-for="p in status.proofs" :key="p.id">
                  <td>{{ p.game_name }}</td>
                  <td>{{ PROOF_TYPES.find(t => t.key === p.type)?.label || p.type }}</td>
                  <td>{{ p.images.length }} 张</td>
                  <td><span class="badge" :class="proofStatusMap[p.status]?.badge || 'badge'">{{ proofStatusMap[p.status]?.label || p.status }}</span></td>
                  <td class="muted small">{{ p.status === 'rejected' ? (p.reject_reason || '不符合要求') : '-' }}</td>
                  <td class="muted small">{{ fmtDateTime(p.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ================= 发布商品 ================= -->
    <template v-else-if="tab === 'publish'">
      <div class="card card-pad mb16">
        <div class="row wrap" style="gap:8px">
          <template v-for="(s, i) in STEPS" :key="s">
            <span class="chip" :class="{ active: step === i + 1 }">{{ i + 1 }}. {{ s }}</span>
            <span v-if="i < STEPS.length - 1" class="muted">→</span>
          </template>
        </div>
        <p v-if="!isApproved" class="small mt8" style="color:var(--warning)">
          需先获得卖家资质才能提交审核。<button class="btn btn-ghost btn-sm" style="margin-left:8px" @click="tab = 'entry'">去入驻</button>
        </p>
      </div>

      <!-- 步骤 1：填写信息 -->
      <div v-if="step === 1" class="card card-pad" style="max-width:760px">
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">游戏 <span class="req">*</span></label>
            <select v-model="form.game_id" class="select">
              <option value="">请选择游戏</option>
              <option v-for="g in templates" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
          <div class="form-item">
            <label class="form-label">区服 <span class="req">*</span></label>
            <select v-if="serverOptions.length" v-model="form.server_name" class="select">
              <option value="">请选择区服</option>
              <option v-for="s in serverOptions" :key="s.name" :value="s.name">{{ s.name }}（{{ s.type }}）</option>
            </select>
            <input v-else v-model="form.server_name" class="input" maxlength="30" placeholder="手动填写区服名" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">渠道</label>
            <select v-model="form.channel" class="select">
              <option value="">默认（官服）</option>
              <option value="官服">官服</option>
              <option value="渠道服">渠道服</option>
            </select>
          </div>
          <div class="form-item">
            <label class="form-label">账号标识 <span class="req">*</span></label>
            <input v-model="form.account_id" class="input" maxlength="50" placeholder="游戏内 ID/昵称，展示时自动脱敏" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">售价（元）<span class="req">*</span></label>
            <input v-model="form.price" type="number" min="1" step="0.01" class="input" placeholder="≥ 1 元" />
          </div>
          <div class="form-item">
            <label class="form-label">买家保障</label>
            <label class="check-row" style="margin-top:8px">
              <input v-model="form.support_compensation" type="checkbox" /> 支持包赔服务（买家可加购）
            </label>
          </div>
        </div>

        <div class="card-title mt8">结构化资产信息（按游戏模板，估值依据）</div>
        <div v-if="!assetTemplate.length" class="muted small mb16">请先选择游戏</div>
        <div class="form-row wrap">
          <div v-for="t in assetTemplate" :key="t.key" class="form-item" style="flex:1 1 45%">
            <label class="form-label">{{ t.label }} <span class="req">*</span></label>
            <input
              v-model="form.assets[t.key]"
              :type="t.type === 'number' ? 'number' : 'text'"
              class="input"
              :placeholder="t.sample ? `例：${t.sample}` : ''"
            />
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">描述（≤500 字，禁止站外联系方式/私下交易话术）</label>
          <textarea v-model="form.description" class="textarea" rows="4" maxlength="500" placeholder="账号亮点、充值情况、绑定状态等"></textarea>
        </div>
        <button class="btn btn-primary btn-lg" @click="nextStep">下一步：上传截图</button>
      </div>

      <!-- 步骤 2：上传截图 -->
      <div v-else-if="step === 2" class="card card-pad" style="max-width:760px">
        <div class="form-item">
          <label class="form-label">原始截图（{{ MIN_RAW }}-{{ MAX_RAW }} 张）<span class="req">*</span></label>
          <div class="img-grid">
            <div v-for="(img, idx) in rawImages" :key="img" class="img-ph" style="position:relative">
              <img :src="img" alt="截图" style="width:100%;height:100%;object-fit:contain" />
              <button class="btn btn-sm btn-ghost" style="position:absolute;top:4px;right:4px" @click="removeRaw(idx)">×</button>
            </div>
            <label v-if="rawImages.length < MAX_RAW" class="img-ph" style="cursor:pointer">
              <input type="file" accept="image/*" multiple hidden :disabled="rawUploading" @change="onRawFileChange" />
              <span v-if="rawUploading">上传中…</span>
              <span v-else>+ 上传截图</span>
            </label>
          </div>
          <div class="form-hint">上传段位页、皮肤仓库、充值记录等关键页面截图；提交审核后 AI 将一键生成标准化展示图组。</div>
        </div>
        <div class="row">
          <button class="btn btn-ghost" @click="prevStep">上一步</button>
          <button class="btn btn-primary btn-lg" @click="nextStep">下一步：确认并提交审核</button>
        </div>
      </div>

      <!-- 步骤 3：提交审核 -->
      <div v-else-if="step === 3" class="card card-pad" style="max-width:760px">
        <div class="card-title">信息确认</div>
        <dl class="kv-list mb16">
          <dt>游戏</dt><dd>{{ selectedGame?.name }} · {{ form.server_name }}{{ form.channel ? ' · ' + form.channel : '' }}</dd>
          <dt>账号标识</dt><dd>{{ form.account_id }}</dd>
          <dt>售价</dt><dd>{{ fmtPrice(form.price) }}<span v-if="form.support_compensation" class="badge badge-success" style="margin-left:8px">支持包赔</span></dd>
          <dt>资产</dt><dd>{{ assetTemplate.map(t => `${t.label}：${form.assets[t.key]}`).join('；') }}</dd>
          <dt>截图</dt><dd>{{ rawImages.length }} 张原始截图</dd>
          <dt>描述</dt><dd class="muted small">{{ form.description || '（无）' }}</dd>
        </dl>
        <p class="muted small mb16">提交后进入运营审核；审核通过即上架并自动生成 AI 估值。</p>
        <div class="row">
          <button class="btn btn-ghost" @click="prevStep">上一步</button>
          <button class="btn btn-primary btn-lg" :disabled="submitting || !isApproved || isBanned" @click="submitListing">
            {{ submitting ? '提交中…' : '提交审核' }}
          </button>
        </div>
      </div>

      <!-- 步骤 4：生成图 + 估值 -->
      <div v-else class="card card-pad" style="max-width:760px">
        <div class="card-title">商品 #{{ createdId }} 已提交审核</div>
        <div class="form-item">
          <div class="row between">
            <label class="form-label" style="margin:0">AI 标准化展示图（4 张）</label>
            <button class="btn btn-primary btn-sm" :disabled="genLoading" @click="generateImages">
              {{ genLoading ? '生成中…' : genImages.length ? '重新生成' : '一键生成展示图' }}
            </button>
          </div>
          <div v-if="genImages.length" class="img-grid mt8">
            <a v-for="(img, i) in genImages" :key="img" :href="img" target="_blank" class="img-ph img-ph-link">
              <img :src="img" :alt="`展示图 ${i + 1}`" />
            </a>
          </div>
          <div v-else class="muted small mt8">生成后可在商品详情中作为买家看到的图组（可被审核替换）。</div>
        </div>
        <div class="form-item">
          <div class="row between">
            <label class="form-label" style="margin:0">AI 估值</label>
            <button class="btn btn-ghost btn-sm" @click="refreshValuation">刷新估值</button>
          </div>
          <div v-if="valuation" class="card card-pad mt8" style="background:var(--bg)">
            <div class="row wrap" style="gap:14px">
              <span>估值区间：<b style="color:var(--danger)">{{ fmtPrice(valuation.low) }} - {{ fmtPrice(valuation.high) }}</b></span>
              <span>中枢价：{{ fmtPrice(valuation.mid) }}</span>
              <span>性价比分：{{ valuation.score }}</span>
              <span>置信度：{{ CONF_LABEL[valuation.confidence] || valuation.confidence }}</span>
            </div>
          </div>
          <div v-else class="muted small mt8">估值将在审核通过后自动生成，本页每 8 秒自动刷新一次。</div>
        </div>
        <div class="row">
          <button class="btn btn-ghost" @click="switchTab('goods')">查看我的商品</button>
          <button class="btn btn-primary" @click="resetWizard">再发一个商品</button>
        </div>
      </div>
    </template>

    <!-- ================= 我的商品 ================= -->
    <template v-else>
      <div class="row between mb16">
        <span class="muted small">共 {{ goods.length }} 件商品</span>
        <button class="btn btn-ghost btn-sm" :disabled="goodsLoading" @click="loadGoods">刷新</button>
      </div>
      <div v-if="goodsLoading && !goods.length" class="loading-box"><div class="spinner"></div>加载中…</div>
      <div v-else-if="goods.length" class="card" style="overflow:hidden">
        <div v-for="l in goods" :key="l.id" class="msg-item" style="cursor:pointer" @click="router.push(`/self/${l.id}`)">
          <div style="flex:1; min-width:0">
            <div class="row wrap" style="gap:8px">
              <span class="badge" :class="listingStatusMap[l.status]?.badge || 'badge'">{{ listingStatusMap[l.status]?.label || l.status }}</span>
              <b style="font-size:14px">#{{ l.id }} {{ l.game_name }} · {{ l.server_name }}</b>
              <span v-if="l.verified" class="badge badge-success">已验归属</span>
            </div>
            <div class="muted small" style="margin-top:4px">
              {{ l.account_mask }}<span v-if="l.channel"> · {{ l.channel }}</span>
              · 截图 {{ l.raw_count }} 张 · 展示图组 {{ l.images.length }} 张
              · 发布于 {{ fmtDateTime(l.created_at) }}
            </div>
            <div v-if="l.status === 'rejected'" class="small mt8" style="color:var(--danger)">驳回原因：{{ l.reject_reason || '不符合要求' }}（修改后可重新提交）</div>
            <div v-if="l.valuation" class="small mt8" style="color:var(--text2)">
              估值 {{ fmtPrice(l.valuation.low) }} - {{ fmtPrice(l.valuation.high) }} · 性价比 {{ l.valuation.score }} 分 · 置信度 {{ CONF_LABEL[l.valuation.confidence] || l.valuation.confidence }}
            </div>
          </div>
          <div style="text-align:right; flex:none; display:flex; flex-direction:column; gap:8px; align-items:flex-end">
            <div style="font-size:16px; font-weight:700; color:var(--danger)">{{ fmtPrice(l.price) }}</div>
            <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
              <button
                v-if="['on', 'review'].includes(l.status)"
                class="btn btn-ghost btn-sm"
                @click.stop="offlineListing(l)"
              >下架</button>
              <button
                v-if="['on', 'review', 'offline', 'rejected'].includes(l.status)"
                class="btn btn-primary btn-sm"
                @click.stop="openEdit(l)"
              >{{ l.status === 'rejected' ? '修改重提' : '编辑' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card">
        <EmptyState text="还没有发布过自营商品，前往「发布商品」上传第一个账号吧" icon="🏪">
          <button class="btn btn-primary" @click="switchTab('publish')">去发布</button>
        </EmptyState>
      </div>
    </template>

    <!-- 编辑弹窗 -->
    <Modal v-if="editTarget" :title="editTarget.status === 'rejected' ? '修改后重新提交审核' : `编辑商品 #${editTarget.id}`" @close="editTarget = null">
      <div class="form-item">
        <label class="form-label">售价（元）</label>
        <input v-model="editForm.price" type="number" min="1" step="0.01" class="input" />
        <div class="form-hint">在售商品改价将触发 AI 重新估值</div>
      </div>
      <div class="form-item">
        <label class="form-label">描述</label>
        <textarea v-model="editForm.description" class="textarea" rows="4" maxlength="500"></textarea>
      </div>
      <label class="check-row">
        <input v-model="editForm.support_compensation" type="checkbox" /> 支持包赔服务
      </label>
      <template #foot>
        <button class="btn btn-ghost" :disabled="editSaving" @click="editTarget = null">取消</button>
        <button class="btn btn-primary" :disabled="editSaving" @click="saveEdit">{{ editSaving ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </main>
</template>
