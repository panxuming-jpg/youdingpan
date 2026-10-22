<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, getToken } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';

const loading = ref(true);
const experts = ref([]);        // GET /expert/me
const games = ref([]);
const pool = ref([]);           // GET /expert/pool
const active = ref([]);         // 我已接单的进行中鉴号单（GET /appraisals/:id）
const wallet = ref(null);
const shareLogs = ref([]);      // /wallet/logs 中 biz='expert_share'
const realNameOk = ref(false);
const tab = ref('pool');

const ACCEPTED_KEY = 'ydp_expert_accepted';
function savedIds() {
  try { return JSON.parse(localStorage.getItem(ACCEPTED_KEY) || '[]'); } catch { return []; }
}
function setSavedIds(ids) { localStorage.setItem(ACCEPTED_KEY, JSON.stringify(ids)); }

const QUAL_LABEL = { applying: '入驻审核中', trial: '试鉴定阶段', approved: '已签约专家', suspended: '已暂停接单' };
const QUAL_BADGE = { applying: 'badge-warning', trial: 'badge-primary', approved: 'badge-success', suspended: 'badge-danger' };
const CONCLUSIONS = [
  { key: 'match', label: '相符' },
  { key: 'partial', label: '部分不符' },
  { key: 'mismatch', label: '不符' },
  { key: 'incapable', label: '无法鉴定' },
];
const INCAPABLE_REASONS = [
  { key: 'seller_uncooperative', label: '卖家不配合（按「不符」规则处理）' },
  { key: 'expert_unable', label: '本人能力不足（鉴号费退买家并转单重鉴）' },
];

const isExpert = computed(() => experts.value.some(e => ['trial', 'approved'].includes(e.status)));

async function loadAll() {
  try {
    experts.value = await api('/expert/me');
  } catch (e) {
    toast.error(e.message);
  }
  try {
    const s = await api('/seller/status');
    realNameOk.value = !!(s.real_name && s.face_verified);
  } catch { /* 静默 */ }
  try {
    games.value = await api('/games');
  } catch { /* 静默 */ }
  if (isExpert.value) {
    await Promise.all([loadPool(), loadActive(), loadIncome()]);
  }
  loading.value = false;
}

async function loadPool() {
  try { pool.value = await api('/expert/pool'); } catch (e) { toast.error(e.message); }
}

async function loadActive() {
  const ids = savedIds();
  const rows = [];
  const keep = [];
  for (const aid of ids) {
    try {
      const a = await api(`/appraisals/${aid}`);
      if (a.status === 'in_progress' && a.expert_id === store.user?.id) {
        rows.push(a);
        keep.push(aid);
      } else if (a.status !== 'reported' && a.status !== 'reassigned' && a.expert_id === store.user?.id) {
        keep.push(aid);
      }
    } catch { /* 无权限或已删除，移出本地记录 */ }
  }
  setSavedIds(keep);
  active.value = rows;
}

async function loadIncome() {
  try { wallet.value = await api('/wallet'); } catch { /* 静默 */ }
  try {
    const logs = await api('/wallet/logs');
    shareLogs.value = logs.filter(l => l.biz === 'expert_share');
  } catch { /* 静默 */ }
}

const shareTotal = computed(() => shareLogs.value.reduce((s, l) => s + (l.amount || 0), 0));

// ---------- 入驻申请 ----------
const applyForm = ref({ game_id: '', qual_images: [] });
const applying = ref(false);
const uploading = ref(false);
async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '上传失败');
  return j.data.url;
}
async function onQualFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  uploading.value = true;
  try {
    for (const f of files.slice(0, 6 - applyForm.value.qual_images.length)) {
      applyForm.value.qual_images.push(await uploadImage(f));
    }
  } catch (err) {
    toast.error(err.message);
  } finally {
    uploading.value = false;
  }
}
async function submitApply() {
  if (!realNameOk.value) return toast.error('请先在「我的-实名认证」完成实名与人脸核验');
  const g = Number(applyForm.value.game_id);
  if (!g) return toast.error('请选择授权游戏');
  if (!applyForm.value.qual_images.length) return toast.error('请上传资历证明（段位/资产/交易履历截图）');
  applying.value = true;
  try {
    await api('/expert/apply', { method: 'POST', body: { game_id: g, qual_images: applyForm.value.qual_images } });
    toast.success('入驻申请已提交，等待运营审核（通过后进入试鉴定阶段）');
    applyForm.value = { game_id: '', qual_images: [] };
    await loadAll();
  } catch (e) {
    toast.error(e.message);
  } finally {
    applying.value = false;
  }
}

// ---------- 接单 ----------
const acceptingId = ref(0);
async function accept(a) {
  if (acceptingId.value) return;
  acceptingId.value = a.id;
  try {
    await api(`/appraisals/${a.id}/accept`, { method: 'POST' });
    const ids = savedIds();
    if (!ids.includes(a.id)) setSavedIds([...ids, a.id]);
    toast.success(`已接单 #${a.id}，请在 24 小时内出具鉴定报告`);
    await Promise.all([loadPool(), loadActive()]);
    tab.value = 'doing';
  } catch (e) {
    toast.error(e.message);
  } finally {
    acceptingId.value = 0;
  }
}

// ---------- 提交报告 ----------
const reportFor = ref(null);   // 当前填写报告的 appraisal
const repForm = ref(null);
function openReport(a) {
  reportFor.value = a;
  repForm.value = {
    conclusion: 'match',
    risk_level: 'low',
    advice: '',
    incapable_reason: 'seller_uncooperative',
    items: [{ name: '', claimed: '', actual: '', match: true }],
  };
}
function addItem() { repForm.value.items.push({ name: '', claimed: '', actual: '', match: true }); }
function removeItem(i) { repForm.value.items.splice(i, 1); }
const repLoading = ref(false);
async function submitReport() {
  const f = repForm.value;
  const needItems = ['match', 'partial', 'mismatch'].includes(f.conclusion);
  const items = needItems ? f.items.filter(i => i.name.trim()) : [];
  if (needItems && !items.length) return toast.error('请至少填写一项资产核对项');
  if (f.conclusion === 'incapable' && !f.incapable_reason) return toast.error('请选择无法鉴定的原因');
  repLoading.value = true;
  try {
    await api(`/appraisals/${reportFor.value.id}/report`, { method: 'POST', body: {
      conclusion: f.conclusion,
      items,
      risk_level: f.risk_level,
      advice: f.advice.trim(),
      incapable_reason: f.conclusion === 'incapable' ? f.incapable_reason : undefined,
    } });
    toast.success('鉴定报告已提交，分成将自动结算到您的钱包');
    setSavedIds(savedIds().filter(x => x !== reportFor.value.id));
    reportFor.value = null;
    await Promise.all([loadActive(), loadIncome()]);
    tab.value = 'income';
  } catch (e) {
    toast.error(e.message);
  } finally {
    repLoading.value = false;
  }
}

function assetSummary(assets) {
  const entries = Object.entries(assets || {}).slice(0, 4);
  return entries.length ? entries.map(([k, v]) => `${k}：${v}`).join(' · ') : '资产清单见订单会话';
}

onMounted(loadAll);
</script>

<template>
  <main class="container page">
    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载工作台…</div>

    <template v-else>
      <div class="page-title">鉴号专家工作台</div>
      <div class="page-sub">实名专家接单出具账号鉴定报告，报告永久挂订单证据链；完成鉴定即自动结算专家分成入钱包</div>

      <!-- 我的资质 -->
      <div class="card card-pad mb16">
        <div class="card-title">我的专家资质</div>
        <div v-if="experts.length" class="row wrap" style="gap:10px">
          <div v-for="e in experts" :key="e.id" class="qual-card">
            <div class="row" style="gap:8px; align-items:center">
              <b>{{ e.game_name || `游戏 #${e.game_id}` }}</b>
              <span class="badge" :class="QUAL_BADGE[e.status] || 'badge'">{{ QUAL_LABEL[e.status] || e.status }}</span>
            </div>
            <div class="small muted mt8">
              申请于 {{ fmtDateTime(e.created_at) }}
              <template v-if="e.status === 'trial'"> · 试鉴定已完成 {{ e.trial_done || 0 }} 单（完成考核自动转正）</template>
              <template v-if="e.reviewed_at"> · 审核于 {{ fmtDateTime(e.reviewed_at) }}</template>
            </div>
          </div>
        </div>
        <div v-else class="small muted">您尚未申请任何游戏的鉴号专家授权，请在下方提交入驻申请。</div>
      </div>

      <!-- 未入驻：申请表单 -->
      <div v-if="!experts.length" class="card card-pad mb16">
        <div class="card-title">专家入驻申请</div>
        <p v-if="!realNameOk" class="banner-warn mb16">需先完成实名认证与人脸核验（我的-实名认证）后方可申请入驻。</p>
        <div class="form-item">
          <label class="form-label">授权游戏 <span class="req">*</span></label>
          <select v-model="applyForm.game_id" class="select">
            <option value="" disabled>请选择您擅长的游戏</option>
            <option v-for="g in games" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="form-label">资历证明 <span class="req">*</span></label>
          <div class="small muted mb16">上传段位截图、账号资产截图、历史交易履历等（1-6 张），供运营审核授权。</div>
          <div class="row wrap" style="gap:8px; margin-bottom:10px">
            <div v-for="(u, i) in applyForm.qual_images" :key="u" class="thumb">
              <img :src="u" alt="资历证明" />
              <button class="thumb-x" title="移除" @click="applyForm.qual_images.splice(i, 1)">×</button>
            </div>
          </div>
          <label class="btn btn-ghost btn-sm">
            {{ uploading ? '上传中…' : '上传图片' }}
            <input type="file" accept="image/*" multiple hidden :disabled="uploading" @change="onQualFile" />
          </label>
        </div>
        <button class="btn btn-primary mt8" :disabled="applying || !realNameOk" @click="submitApply">
          {{ applying ? '提交中…' : '提交入驻申请' }}
        </button>
      </div>

      <!-- 已入驻：工作台 -->
      <template v-if="isExpert">
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'pool' }" @click="tab = 'pool'">接单池（{{ pool.length }}）</button>
          <button class="tab" :class="{ active: tab === 'doing' }" @click="tab = 'doing'">进行中（{{ active.length }}）</button>
          <button class="tab" :class="{ active: tab === 'income' }" @click="tab = 'income'">我的收益</button>
        </div>

        <!-- 接单池 -->
        <div v-if="tab === 'pool'">
          <div v-if="pool.length" class="row wrap" style="gap:14px; align-items:stretch">
            <div v-for="a in pool" :key="a.id" class="card card-pad pool-card">
              <div class="row wrap" style="gap:8px; align-items:center">
                <b>{{ a.game_name }}</b>
                <span v-if="a.server_name" class="badge">{{ a.server_name }}</span>
                <span class="badge badge-warning">待接单</span>
              </div>
              <div class="small muted mt8">商品价款 {{ fmtPrice(a.price) }} · 鉴号费 {{ fmtPrice(a.fee) }} · 买家支付于 {{ fmtDateTime(a.paid_at) }}</div>
              <div class="small mt8" style="word-break:break-all">{{ assetSummary(a.assets) }}</div>
              <div class="small muted mt8">鉴号单 #{{ a.id }}{{ a.order_id ? ` · 订单 #${a.order_id}` : ' · 下单前预鉴' }}</div>
              <button class="btn btn-primary btn-sm mt16" :disabled="acceptingId === a.id" @click="accept(a)">
                {{ acceptingId === a.id ? '接单中…' : '接单（24h 内出报告）' }}
              </button>
            </div>
          </div>
          <div v-else class="card"><EmptyState text="当前没有您授权游戏的待接单鉴号单，可先完善资质或等待买家下单" /></div>
        </div>

        <!-- 进行中 -->
        <div v-if="tab === 'doing'">
          <div v-if="active.length" class="card card-pad">
            <div v-for="a in active" :key="a.id" class="doing-item">
              <div class="row between wrap" style="gap:10px; align-items:center">
                <div>
                  <b>鉴号单 #{{ a.id }}</b>
                  <span class="badge badge-primary" style="margin-left:8px">鉴定中</span>
                  <div class="small muted mt8">接单于 {{ fmtDateTime(a.accepted_at) }} · 商品 #{{ a.listing_id }}{{ a.order_id ? ` · 订单 #${a.order_id}` : '' }}</div>
                </div>
                <button class="btn btn-primary btn-sm" @click="openReport(a)">出具鉴定报告</button>
              </div>
            </div>
          </div>
          <div v-else class="card"><EmptyState text="暂无进行中的鉴号单，请到接单池接单" /></div>
        </div>

        <!-- 收益 -->
        <div v-if="tab === 'income'">
          <div class="row wrap mb16" style="gap:14px">
            <div class="card card-pad stat-card">
              <div class="small muted">累计鉴号分成</div>
              <div class="stat-num" style="color:var(--success)">{{ fmtPrice(shareTotal) }}</div>
              <div class="small muted">{{ shareLogs.length }} 笔已完成结算</div>
            </div>
            <div class="card card-pad stat-card">
              <div class="small muted">钱包可用余额</div>
              <div class="stat-num">{{ wallet ? fmtPrice(wallet.balance) : '-' }}</div>
              <div class="small muted">冻结 {{ wallet ? fmtPrice(wallet.frozen) : '-' }} · 可在「我的钱包」提现</div>
            </div>
          </div>
          <div class="card card-pad">
            <div class="card-title">分成入账记录</div>
            <div v-if="shareLogs.length" class="table-wrap">
              <table class="table">
                <thead><tr><th>鉴号单</th><th>分成金额</th><th>说明</th><th>入账时间</th></tr></thead>
                <tbody>
                  <tr v-for="l in shareLogs" :key="l.id">
                    <td>{{ l.ref_no }}</td>
                    <td style="font-weight:700; color:var(--success)">+{{ fmtPrice(l.amount) }}</td>
                    <td class="muted">{{ l.remark }}</td>
                    <td class="muted">{{ fmtDateTime(l.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="muted small">暂无分成记录，完成鉴定报告后自动结算。</div>
          </div>
        </div>
      </template>

      <!-- 已申请但尚未通过审核 -->
      <div v-else-if="experts.length" class="card card-pad">
        <EmptyState icon="⏳" text="入驻申请审核中：通过后进入试鉴定阶段（完成考核自动转正），届时可在此接单。" />
      </div>

      <!-- 报告弹窗 -->
      <Modal v-if="reportFor && repForm" :title="`鉴号单 #${reportFor.id} · 出具鉴定报告`" wide @close="reportFor = null">
        <div class="form-item">
          <label class="form-label">鉴定结论 <span class="req">*</span></label>
          <select v-model="repForm.conclusion" class="select">
            <option v-for="c in CONCLUSIONS" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
          <div class="form-hint">
            「相符」商品挂 30 天已鉴标识；「部分不符/不符」将联动订单（买家可取消全额退款，两次不符商品下架冻结卖家钱包）；「无法鉴定-卖家不配合」按不符处理。
          </div>
        </div>

        <template v-if="repForm.conclusion !== 'incapable'">
          <div class="form-item">
            <label class="form-label">资产核对表（对照商品图组逐项核验）</label>
            <div v-for="(it, i) in repForm.items" :key="i" class="row wrap item-row">
              <input v-model="it.name" class="input" style="flex:2; min-width:110px" placeholder="核对项，如：典藏皮肤数" />
              <input v-model="it.claimed" class="input" style="flex:1.5; min-width:90px" placeholder="卖家填报" />
              <input v-model="it.actual" class="input" style="flex:1.5; min-width:90px" placeholder="实际核验" />
              <label class="check-row"><input v-model="it.match" type="checkbox" />相符</label>
              <button class="btn btn-ghost btn-sm" type="button" :disabled="repForm.items.length <= 1" @click="removeItem(i)">删除</button>
            </div>
            <button class="btn btn-ghost btn-sm mt8" type="button" @click="addItem">+ 添加核对项</button>
          </div>
          <div class="form-item">
            <label class="form-label">找回风险等级</label>
            <select v-model="repForm.risk_level" class="select">
              <option value="low">低</option>
              <option value="mid">中</option>
              <option value="high">高</option>
            </select>
          </div>
        </template>
        <div v-else class="form-item">
          <label class="form-label">无法鉴定原因 <span class="req">*</span></label>
          <select v-model="repForm.incapable_reason" class="select">
            <option v-for="r in INCAPABLE_REASONS" :key="r.key" :value="r.key">{{ r.label }}</option>
          </select>
        </div>

        <div class="form-item">
          <label class="form-label">专家建议（可选）</label>
          <textarea v-model="repForm.advice" class="textarea" rows="3" placeholder="给买家的交易/换绑/风控建议"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="reportFor = null">取消</button>
          <button class="btn btn-primary" :disabled="repLoading" @click="submitReport">{{ repLoading ? '提交中…' : '提交报告并结算分成' }}</button>
        </template>
      </Modal>
    </template>
  </main>
</template>

<style scoped>
.qual-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 240px; }
.banner-warn { background: var(--warning-weak, #fffbeb); border: 1px solid var(--warning, #f59e0b); color: #b45309; border-radius: 10px; padding: 10px 14px; font-size: 13px; }
.pool-card { width: 320px; display: flex; flex-direction: column; }
.doing-item { padding: 12px 0; border-bottom: 1px dashed var(--border); }
.doing-item:last-child { border-bottom: none; }
.stat-card { flex: 1; min-width: 220px; }
.stat-num { font-size: 26px; font-weight: 800; margin: 6px 0 4px; }
.item-row { gap: 8px; margin-bottom: 8px; align-items: center; }
.thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-x {
  position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border: none;
  border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; cursor: pointer; line-height: 1;
}
</style>
