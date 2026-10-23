<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { fmtPrice, fmtDateTime, rightsStatus, claimTypeLabel, RIGHTS_DOC_KIND, openDocWindow } from '../utils.js';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import Pagination from '../components/Pagination.vue';

const tab = ref('listings');
const loading = ref(false);
const isAdmin = computed(() => !!store.user?.is_admin);

// ---------- 状态/类型映射 ----------
const LISTING_STATUS = {
  pending: { label: '待审核', badge: 'badge-warning' },
  review: { label: '需复核', badge: 'badge-warning' },
  on: { label: '在售', badge: 'badge-success' },
  locked: { label: '交易锁定', badge: 'badge-primary' },
  rejected: { label: '已驳回', badge: 'badge-danger' },
  offline: { label: '已下架', badge: '' },
  sold: { label: '已售出', badge: 'badge-success' },
};
const PROOF_TYPE = {
  register_page: '注册页',
  first_bill: '首充凭证',
  realname_page: '实名核验页',
  device_shot: '设备截图',
};
const CLAIM_STATUS = {
  submitted: { label: '待审核', badge: 'badge-warning' },
  reviewing: { label: 'AI 初核完成', badge: 'badge-primary' },
  approved: { label: '已赔付', badge: 'badge-success' },
  rejected: { label: '已驳回', badge: 'badge-danger' },
};
const RISK_TYPE = {
  offsite: { label: '站外联系', badge: 'badge-danger' },
  phishing: { label: '钓鱼链接', badge: 'badge-danger' },
  credential_ask: { label: '索取凭据', badge: 'badge-warning' },
  silence: { label: '静默失联', badge: 'badge-primary' },
};
const REFUND_STATUS = {
  refunding: { label: '退款申请中', badge: 'badge-warning' },
  seller_appealed: { label: '申诉待裁决', badge: 'badge-danger' },
};
const EXPERT_STATUS = {
  applying: { label: '待审核', badge: 'badge-warning' },
  trial: { label: '试鉴定', badge: 'badge-primary' },
  approved: { label: '已签约', badge: 'badge-success' },
  suspended: { label: '已暂停', badge: 'badge-danger' },
};
const CONF_LABEL = { high: '高', mid: '中', low: '低' };

// ---------- 各 tab 数据与加载 ----------
const listings = ref([]);
const listingStatus = ref('pending');
async function loadListings() {
  try {
    listings.value = await api('/admin/listings', { query: { status: listingStatus.value } });
  } catch (e) {
    toast.error(e.message);
  }
}

const proofs = ref([]);
async function loadProofs() {
  try {
    proofs.value = await api('/admin/proofs');
  } catch (e) {
    toast.error(e.message);
  }
}

const claims = ref([]);
async function loadClaims() {
  try {
    claims.value = await api('/admin/claims');
  } catch (e) {
    toast.error(e.message);
  }
}

const risks = ref([]);
async function loadRisks() {
  try {
    risks.value = await api('/admin/risk-events');
  } catch (e) {
    toast.error(e.message);
  }
}

const pool = ref(null);
async function loadPool() {
  try {
    pool.value = await api('/admin/comp-pool');
  } catch (e) {
    toast.error(e.message);
  }
}

const experts = ref([]);
async function loadExperts() {
  try {
    experts.value = await api('/admin/experts');
  } catch (e) {
    toast.error(e.message);
  }
}

const refunds = ref([]);
const refundFilter = ref('open');
async function loadRefunds() {
  try {
    refunds.value = await api('/admin/self-orders');
  } catch (e) {
    toast.error(e.message);
  }
}
const refundOrders = computed(() => {
  if (refundFilter.value === 'all') return refunds.value;
  if (refundFilter.value === 'refunding') return refunds.value.filter(o => o.status === 'refunding');
  if (refundFilter.value === 'seller_appealed') return refunds.value.filter(o => o.status === 'seller_appealed');
  return refunds.value.filter(o => ['refunding', 'seller_appealed'].includes(o.status));
});

// ---------- 维权案管理（模块 F） ----------
const rights = ref([]);
const rightsStatusFilter = ref('pending_verify');
async function loadRights() {
  try {
    rights.value = await api('/admin/rights', { query: { status: rightsStatusFilter.value } });
  } catch (e) {
    toast.error(e.message);
  }
}

const rightsDetail = ref(null); // GET /rights/:id 展开区
const rightsDetailLoading = ref(0);
async function toggleRightsRow(row) {
  if (rightsDetail.value?.case?.id === row.id) { rightsDetail.value = null; return; }
  rightsDetailLoading.value = row.id;
  try {
    rightsDetail.value = await api(`/rights/${row.id}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    rightsDetailLoading.value = 0;
  }
}

async function viewRightsDoc(caseId, doc) {
  try {
    const d = await api(`/rights/${caseId}/documents/${doc.id}`);
    if (!openDocWindow(d.html)) toast.error('新窗口被浏览器拦截，请允许弹窗后重试');
  } catch (e) {
    toast.error(e.message);
  }
}

const verifyModal = ref(null); // { case, action: 'pass' | 'reject' }
const verifyForm = ref({ freeze_amount: '', reject_reason: '' });
const verifySubmitting = ref(false);
function openVerify(row, action) {
  verifyModal.value = { case: row, action };
  verifyForm.value = { freeze_amount: action === 'pass' ? String(row.loss) : '', reject_reason: '' };
}
async function submitVerify() {
  const m = verifyModal.value;
  if (!m) return;
  if (m.action === 'reject' && !verifyForm.value.reject_reason.trim()) return toast.error('驳回必须填写理由');
  verifySubmitting.value = true;
  try {
    const body = m.action === 'pass'
      ? { pass: true, freeze_amount: Number(verifyForm.value.freeze_amount) > 0 ? Number(verifyForm.value.freeze_amount) : undefined }
      : { pass: false, reject_reason: verifyForm.value.reject_reason.trim() };
    await api(`/admin/rights/${m.case.id}/verify`, { method: 'POST', body });
    toast.success(m.action === 'pass' ? '核验成立：已立案并冻结卖家资金' : '核验驳回，已通知买家');
    verifyModal.value = null;
    await loadRights();
  } catch (e) {
    toast.error(e.message);
  } finally {
    verifySubmitting.value = false;
  }
}

async function certIssue(row) {
  try {
    const d = await api(`/admin/rights/${row.id}/cert-issue`, { method: 'POST', body: {} });
    toast.success(`《交易存证证明》已签发（文书 #${d.doc_id}），买家可在维权案详情查看下载`);
    if (rightsDetail.value?.case?.id === row.id) await toggleRightsRow(row); // 收起再展开刷新文书列表
  } catch (e) {
    toast.error(e.message);
  }
}

async function unfreezeCase(row) {
  if (!confirm(`确认解除维权案 #${row.id} 的卖家钱包冻结 ${fmtPrice(row.freeze_amount)}？`)) return;
  try {
    const d = await api(`/admin/rights/${row.id}/unfreeze`, { method: 'POST' });
    toast.success(`已解除冻结 ${fmtPrice(d.unfrozen)}`);
    await loadRights();
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 派出所数据管理（模块 G） ----------
const policeList = ref([]);
const policeTotal = ref(0);
const policePage = ref(1);
const policeSize = 20;
const policeKeyword = ref('');
const policeProvince = ref('');
const policeProvinces = ref([]);
const feedbacks = ref([]);

// 高德 Web 服务 Key（实时补充查询用；存 settings，即时生效）
const amapKey = ref('');
const amapEnabled = ref(false);
const amapSaving = ref(false);
async function loadAmapStatus() {
  try { amapEnabled.value = (await api('/police/realtime-status')).enabled; } catch { /* 静默 */ }
}
async function saveAmapKey() {
  amapSaving.value = true;
  try {
    const d = await api('/admin/police/amap-key', { method: 'POST', body: { key: amapKey.value } });
    amapEnabled.value = d.enabled;
    toast.success(d.enabled ? '高德 Key 已保存，实时补充查询已启用' : '高德 Key 已清空');
    amapKey.value = '';
  } catch (e) {
    toast.error(e.message);
  } finally {
    amapSaving.value = false;
  }
}

async function loadPolice() {
  try {
    const d = await api('/admin/police', {
      query: { page: policePage.value, size: policeSize, keyword: policeKeyword.value, province: policeProvince.value },
    });
    policeList.value = d.list;
    policeTotal.value = d.total;
  } catch (e) {
    toast.error(e.message);
  }
}
async function loadFeedbacks() {
  try {
    feedbacks.value = await api('/admin/police/feedbacks');
  } catch (e) {
    toast.error(e.message);
  }
}
async function loadPoliceTab() {
  if (!policeProvinces.value.length) {
    try {
      const tree = await api('/police/districts');
      policeProvinces.value = tree.map(t => t.province);
    } catch { /* 静默 */ }
  }
  await Promise.all([loadPolice(), loadFeedbacks(), loadAmapStatus()]);
}
function searchPolice() {
  policePage.value = 1;
  loadPolice();
}

const policeEdit = ref(null);
const policeSaving = ref(false);
const EMPTY_POLICE = {
  name: '', province: '', city: '', district: '', address: '', phone: '',
  officer: '', officer_badge: '', jurisdiction: '', hours: '', lng: '', lat: '', source: '管理端录入',
};
function openPoliceEdit(s) {
  policeEdit.value = s ? { ...s, lng: s.lng ?? '', lat: s.lat ?? '' } : { ...EMPTY_POLICE };
}
async function savePolice() {
  const f = policeEdit.value;
  if (!f) return;
  if (!f.name.trim() || !f.province.trim()) return toast.error('名称与省份为必填');
  policeSaving.value = true;
  try {
    const body = { ...f, name: f.name.trim(), province: f.province.trim() };
    if (body.lng === '' || body.lng == null) body.lng = null;
    if (body.lat === '' || body.lat == null) body.lat = null;
    await api('/admin/police', { method: 'POST', body });
    toast.success(f.id ? '派出所信息已更新' : '派出所已新建');
    policeEdit.value = null;
    await loadPolice();
  } catch (e) {
    toast.error(e.message);
  } finally {
    policeSaving.value = false;
  }
}

const resolveModal = ref(null);
const resolveText = ref('');
const resolveSubmitting = ref(false);
function openResolve(f) {
  resolveModal.value = f;
  resolveText.value = '';
}
async function submitResolve() {
  resolveSubmitting.value = true;
  try {
    await api(`/admin/police/feedbacks/${resolveModal.value.id}/resolve`, {
      method: 'POST', body: { fixed_text: resolveText.value.trim() },
    });
    toast.success('已标记核实修正');
    resolveModal.value = null;
    await loadFeedbacks();
  } catch (e) {
    toast.error(e.message);
  } finally {
    resolveSubmitting.value = false;
  }
}

const loaders = {
  listings: loadListings,
  proofs: loadProofs,
  claims: loadClaims,
  risks: loadRisks,
  pool: loadPool,
  experts: loadExperts,
  refunds: loadRefunds,
  rights: loadRights,
  police: loadPoliceTab,
};

async function loadTab(key) {
  loading.value = true;
  try {
    await loaders[key]();
  } finally {
    loading.value = false;
  }
}

function switchTab(key) {
  tab.value = key;
  loadTab(key);
}

onMounted(() => {
  if (isAdmin.value) loadTab(tab.value);
});

// ---------- 通用审核/裁决确认弹窗 ----------
const reviewModal = ref(null); // { kind: 'listing'|'proof'|'claim'|'expert'|'refund', item, action }
const reviewReason = ref('');
const reviewSubmitting = ref(false);

const REVIEW_EP = {
  listing: id => `/admin/listings/${id}/review`,
  proof: id => `/admin/proofs/${id}/review`,
  claim: id => `/admin/claims/${id}/decide`,
  expert: id => `/admin/experts/${id}/review`,
  refund: id => `/admin/orders/${id}/refund-decide`,
};

const REVIEW_TITLES = {
  'listing:approve': '通过商品审核',
  'listing:reject': '驳回商品',
  'proof:approve': '通过卖家资质',
  'proof:reject': '驳回卖家资质',
  'claim:approve': '理赔通过（先行赔付）',
  'claim:reject': '驳回理赔',
  'expert:approve': '通过专家申请（进入试鉴定）',
  'expert:approve_direct': '专家直接签约入驻',
  'expert:reject': '驳回专家申请',
  'expert:suspend': '暂停专家接单',
  'refund:refund': '同意退款（申诉失败）',
  'refund:continue': '驳回退款（申诉成立）',
};

function openReview(kind, item, action) {
  reviewModal.value = { kind, item, action };
  reviewReason.value = '';
}

const reviewTitle = computed(() => {
  const m = reviewModal.value;
  return m ? REVIEW_TITLES[`${m.kind}:${m.action}`] || '审核确认' : '';
});

const reviewDesc = computed(() => {
  const m = reviewModal.value;
  if (!m) return '';
  const { kind, item, action } = m;
  if (kind === 'listing') {
    const head = `商品 #${item.id}（${item.game_name} · ${item.server_name} · ${item.account_mask}，售价 ${fmtPrice(item.price)}）`;
    return action === 'approve'
      ? `${head}：通过后立即上架，并自动触发首次估值。`
      : `${head}：驳回后卖家可修改重提；24 小时内驳回满 3 次将暂停其发布入口 72 小时。`;
  }
  if (kind === 'proof') {
    const head = `用户 ${item.nickname || `#${item.user_id}`}（${item.phone || '-'}）· ${item.game_name || '-'} · ${PROOF_TYPE[item.type] || item.type}`;
    return action === 'approve'
      ? `${head}：通过后该用户获得卖家资质，可上传账号商品。`
      : `${head}：驳回后用户可重新提交凭证，不限次数。`;
  }
  if (kind === 'claim') {
    const head = `理赔单 #${item.id} · 订单 ${item.order_no || '-'} · 成交价款 ${fmtPrice(item.price)}`;
    return action === 'approve'
      ? `${head}：通过后平台从赔付资金池向买家先行赔付（上限=商品实付价款），同步冻结卖家钱包等额资金并发出追偿通知（15 日）。`
      : `${head}：驳回后买家可补充证据申诉一次。`;
  }
  if (kind === 'refund') {
    const head = `订单 ${item.order_no}（${item.game_name || '-'} · ${item.server_name || '-'} · ${item.account_mask || '-'}）· 实付 ${fmtPrice(item.total)}`;
    return action === 'refund'
      ? `${head}：退款原因「${item.refund_reason || '-'}」。裁决申诉失败，将从担保资金全额退款买家并关闭订单，商品恢复在售。`
      : `${head}：退款原因「${item.refund_reason || '-'}」，卖家已提交申诉。驳回退款即申诉成立，订单回到待买家确认收货，交接继续。`;
  }
  // expert
  const head = `用户 ${item.nickname || `#${item.user_id}`}（${item.phone || '-'}）· ${item.game_name || '-'}`;
  if (action === 'approve') return `${head}：通过后进入试鉴定阶段，完成考核单数后自动转正。`;
  if (action === 'approve_direct') return `${head}：直接签约为正式鉴号专家（跳过试鉴定）。`;
  if (action === 'reject') return `${head}：驳回后申请将被暂停，可重新提交。`;
  return `${head}：暂停后将退出接单池，可后续重新通过。`;
});

const reasonRequired = computed(() => {
  const m = reviewModal.value;
  if (!m) return false;
  if (m.kind === 'refund') return m.action === 'continue';
  return m.action === 'reject' && (m.kind === 'listing' || m.kind === 'claim');
});
const showReason = computed(() => {
  const m = reviewModal.value;
  if (!m) return false;
  if (m.kind === 'expert') return false;
  if (m.kind === 'refund') return true;
  if (m.action === 'reject') return true;
  return m.kind === 'claim'; // 理赔通过可附裁决说明
});
const reasonPlaceholder = computed(() => {
  const m = reviewModal.value;
  if (!m) return '';
  if (m.kind === 'refund') {
    return m.action === 'continue'
      ? '如：证据链显示买家已完成换绑且可正常登录，申诉成立'
      : '裁决说明（可选，写入退款备注；默认「申诉失败，全额退款」）';
  }
  if (m.action === 'reject') {
    return m.kind === 'listing' ? '如：截图与填报资产不符 / 含站外联系方式' : '如：证据链显示换绑后仍可登录，不符合理赔条件';
  }
  return '裁决说明（可选，将记录在理赔单）';
});
const reviewPrimary = computed(() => {
  const m = reviewModal.value;
  if (!m) return false;
  return m.kind === 'refund' ? m.action === 'refund' : m.action.startsWith('approve');
});

async function submitReview() {
  const m = reviewModal.value;
  if (!m) return;
  const reason = reviewReason.value.trim();
  if (reasonRequired.value && !reason) {
    return toast.error(m.kind === 'listing' ? '驳回必须填写原因' : '驳回必须填写理由');
  }
  reviewSubmitting.value = true;
  try {
    await api(REVIEW_EP[m.kind](m.item.id), { method: 'POST', body: { action: m.action, reason } });
    const okMsg = {
      'listing:approve': '商品已通过审核并上架，估值自动生成',
      'listing:reject': '商品已驳回',
      'proof:approve': '卖家资质已通过',
      'proof:reject': '卖家资质已驳回',
      'claim:approve': '理赔已通过：已先行赔付买家，卖家钱包等额冻结并追偿',
      'claim:reject': '理赔已驳回',
      'refund:refund': '已同意退款：买家全额退款，订单关闭',
      'refund:continue': '已驳回退款：申诉成立，交接继续',
    };
    toast.success(okMsg[`${m.kind}:${m.action}`] || '操作成功');
    reviewModal.value = null;
    await loadTab(tab.value);
  } catch (e) {
    toast.error(e.message);
  } finally {
    reviewSubmitting.value = false;
  }
}

// ---------- 理赔详情弹窗 ----------
const claimDetail = ref(null);

function evSrc(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return e.url || e.image || e.path || '';
  return '';
}
function isImgSrc(s) {
  return typeof s === 'string' && (/^https?:\/\//.test(s) || s.startsWith('/')) && /\.(png|jpe?g|gif|webp|svg)$/i.test(s.split('?')[0]);
}
function evText(e) {
  if (typeof e === 'string') return e.length > 60 ? `${e.slice(0, 60)}…` : e;
  if (e && typeof e === 'object') {
    const j = JSON.stringify(e);
    return j.length > 60 ? `${j.slice(0, 60)}…` : j;
  }
  return String(e);
}

function valuationText(l) {
  if (!l.valuation) return null;
  return {
    range: `${fmtPrice(l.valuation.low)}–${fmtPrice(l.valuation.high)}`,
    detail: `中位 ${fmtPrice(l.valuation.mid)} · 置信${CONF_LABEL[l.valuation.confidence] || '-'} · 性价比 ${l.valuation.score ?? '-'}`,
  };
}
</script>

<template>
  <main class="container page">
    <template v-if="!store.ready">
      <div class="loading-box"><div class="spinner"></div>加载中…</div>
    </template>

    <template v-else-if="!isAdmin">
      <div class="page-title">安全交易管理</div>
      <div class="card">
        <EmptyState icon="🔒" text="无管理员权限，请使用管理员账号登录后访问" />
      </div>
    </template>

    <template v-else>
      <div class="page-title">安全交易管理</div>
      <div class="page-sub">卖家商品审核、卖家资质、找回包赔理赔裁决、退款申诉裁决、风险事件与赔付资金池</div>

      <div class="row between mb16" style="align-items:flex-end">
        <div class="tabs" style="flex-wrap:wrap">
          <button
            v-for="t in [
              { key: 'listings', label: '商品审核' },
              { key: 'proofs', label: '卖家资质审核' },
              { key: 'claims', label: '理赔裁决' },
              { key: 'risks', label: '风险事件' },
              { key: 'pool', label: '赔付资金池' },
              { key: 'experts', label: '鉴号专家审核' },
              { key: 'refunds', label: '退款裁决' },
              { key: 'rights', label: '维权案' },
              { key: 'police', label: '派出所数据' },
            ]"
            :key="t.key"
            class="tab"
            :class="{ active: tab === t.key }"
            @click="switchTab(t.key)"
          >{{ t.label }}</button>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadTab(tab)">↻ 刷新</button>
      </div>

      <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

      <!-- 商品审核 -->
      <template v-else-if="tab === 'listings'">
        <div class="card card-pad mb16">
          <div class="row wrap" style="gap:10px">
            <span class="muted small">状态筛选</span>
            <select v-model="listingStatus" class="select" style="width:160px" @change="loadTab('listings')">
              <option value="pending">待审核</option>
              <option value="review">需复核（鉴号不符转入）</option>
              <option value="rejected">已驳回</option>
              <option value="on">在售</option>
              <option value="locked">交易锁定</option>
              <option value="">全部</option>
            </select>
            <span class="muted small">共 {{ listings.length }} 件</span>
          </div>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>ID</th><th>卖家</th><th>游戏 / 区服</th><th>账号（脱敏）</th><th>价格</th>
                <th>图组</th><th>估值</th><th>状态</th><th>提交时间</th><th style="width:150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in listings" :key="l.id">
                <td class="muted">#{{ l.id }}</td>
                <td>{{ l.seller_nick || l.seller_name || `#${l.seller_id}` }}</td>
                <td><b>{{ l.game_name }}</b><div class="muted small">{{ l.server_name }}{{ l.channel ? ` · ${l.channel}` : '' }}</div></td>
                <td class="muted">{{ l.account_mask }}</td>
                <td><b>{{ fmtPrice(l.price) }}</b></td>
                <td>
                  <div>{{ l.images?.length || 0 }} 张</div>
                  <div class="muted small">原图 {{ l.raw_count || 0 }}</div>
                </td>
                <td>
                  <template v-if="valuationText(l)">
                    <b>{{ valuationText(l).range }}</b>
                    <div class="muted small">{{ valuationText(l).detail }}</div>
                  </template>
                  <span v-else class="muted">未估值</span>
                </td>
                <td>
                  <span class="badge" :class="LISTING_STATUS[l.status]?.badge">{{ LISTING_STATUS[l.status]?.label || l.status }}</span>
                  <div v-if="l.status === 'rejected' && l.reject_reason" class="muted small" style="max-width:160px">{{ l.reject_reason }}</div>
                </td>
                <td class="muted">{{ fmtDateTime(l.created_at) }}</td>
                <td>
                  <div v-if="['pending', 'review'].includes(l.status)" class="row" style="gap:6px">
                    <button class="btn btn-primary btn-sm" @click="openReview('listing', l, 'approve')">通过</button>
                    <button class="btn btn-danger-ghost btn-sm" @click="openReview('listing', l, 'reject')">驳回</button>
                  </div>
                  <span v-else class="muted small">—</span>
                </td>
              </tr>
              <tr v-if="!listings.length">
                <td colspan="10"><EmptyState text="当前筛选下暂无商品" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 卖家资质审核 -->
      <template v-else-if="tab === 'proofs'">
        <div class="card card-pad mb16">
          <span class="muted small">待审核凭证 {{ proofs.length }} 条 · 通过后用户获得卖家资质（可上传账号商品）</span>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>ID</th><th>用户</th><th>实名</th><th>游戏</th><th>凭证类型</th>
                <th>凭证图</th><th>提交时间</th><th style="width:150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in proofs" :key="p.id">
                <td class="muted">#{{ p.id }}</td>
                <td><b>{{ p.nickname || `#${p.user_id}` }}</b><div class="muted small">{{ p.phone || '-' }}</div></td>
                <td>{{ p.real_name || '未实名' }}</td>
                <td>{{ p.game_name || '-' }}</td>
                <td><span class="badge badge-primary">{{ PROOF_TYPE[p.type] || p.type }}</span></td>
                <td>
                  <div class="row wrap" style="gap:4px">
                    <img v-for="(u, i) in (p.images || []).slice(0, 4)" :key="i" :src="u" class="thumb" loading="lazy" />
                    <span v-if="!p.images?.length" class="muted small">无图</span>
                    <span v-else-if="p.images.length > 4" class="muted small">等 {{ p.images.length }} 张</span>
                  </div>
                </td>
                <td class="muted">{{ fmtDateTime(p.created_at) }}</td>
                <td>
                  <div class="row" style="gap:6px">
                    <button class="btn btn-primary btn-sm" @click="openReview('proof', p, 'approve')">通过</button>
                    <button class="btn btn-danger-ghost btn-sm" @click="openReview('proof', p, 'reject')">驳回</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!proofs.length">
                <td colspan="8"><EmptyState text="暂无待审核凭证" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 理赔裁决 -->
      <template v-else-if="tab === 'claims'">
        <div class="card card-pad mb16">
          <span class="muted small">共 {{ claims.length }} 单 · 「待审核 / AI 初核完成」需裁决；通过后从赔付资金池先行赔付并冻结卖家钱包等额资金</span>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>理赔单</th><th>订单号</th><th>成交价款</th><th style="min-width:220px">AI 初核建议</th>
                <th>证据</th><th>状态</th><th>申请时间</th><th>裁决结果</th><th style="width:150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in claims" :key="c.id">
                <td class="muted">#{{ c.id }}</td>
                <td><b>{{ c.order_no || '-' }}</b></td>
                <td>{{ fmtPrice(c.price) }}</td>
                <td><div class="advice-cell">{{ c.ai_advice || '等待 AI 初核…' }}</div></td>
                <td>
                  <span class="muted small">{{ (c.evidence || []).length }} 项</span>
                  <button class="btn btn-ghost btn-sm" @click="claimDetail = c">查看</button>
                </td>
                <td><span class="badge" :class="CLAIM_STATUS[c.status]?.badge">{{ CLAIM_STATUS[c.status]?.label || c.status }}</span></td>
                <td class="muted">{{ fmtDateTime(c.created_at) }}</td>
                <td>
                  <template v-if="c.status === 'approved'">
                    <span style="color:var(--success)">已赔付 {{ fmtPrice(c.payout_amount) }}</span>
                    <div class="muted small">{{ c.decision || '-' }} · {{ fmtDateTime(c.decided_at) }}</div>
                  </template>
                  <template v-else-if="c.status === 'rejected'">
                    <span style="color:var(--danger)">已驳回</span>
                    <div class="muted small" style="max-width:180px">{{ c.decision || '-' }}</div>
                  </template>
                  <span v-else class="muted small">待裁决</span>
                </td>
                <td>
                  <div v-if="['submitted', 'reviewing'].includes(c.status)" class="row" style="gap:6px">
                    <button class="btn btn-primary btn-sm" @click="openReview('claim', c, 'approve')">通过赔付</button>
                    <button class="btn btn-danger-ghost btn-sm" @click="openReview('claim', c, 'reject')">驳回</button>
                  </div>
                  <span v-else class="muted small">已裁决</span>
                </td>
              </tr>
              <tr v-if="!claims.length">
                <td colspan="9"><EmptyState text="暂无理赔单" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 风险事件 -->
      <template v-else-if="tab === 'risks'">
        <div class="card card-pad mb16">
          <span class="muted small">共 {{ risks.length }} 条 · 会话内容风控自动识别（站外联系 / 钓鱼链接 / 索取凭据 / 静默失联）</span>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr><th>ID</th><th>类型</th><th>订单号</th><th>描述</th><th>时间</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in risks" :key="r.id">
                <td class="muted">#{{ r.id }}</td>
                <td><span class="badge" :class="RISK_TYPE[r.type]?.badge">{{ RISK_TYPE[r.type]?.label || r.type }}</span></td>
                <td>{{ r.order_no || '-' }}</td>
                <td class="muted">{{ r.detail || '-' }}</td>
                <td class="muted">{{ fmtDateTime(r.created_at) }}</td>
              </tr>
              <tr v-if="!risks.length">
                <td colspan="5"><EmptyState text="暂无风险事件" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 赔付资金池 -->
      <template v-else-if="tab === 'pool'">
        <div v-if="pool" class="stat-grid mb16">
          <div class="card stat-card">
            <div class="stat-value" style="color:var(--success)">{{ fmtPrice(pool.balance) }}</div>
            <div class="stat-label">资金池当前余额</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{{ fmtPrice(pool.total_accrual) }}</div>
            <div class="stat-label">累计计提（包赔服务费分成）</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value" style="color:var(--danger)">{{ fmtPrice(pool.total_payout) }}</div>
            <div class="stat-label">累计先行赔付支出</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{{ Math.round((pool.accrual_rate || 0) * 100) }}%</div>
            <div class="stat-label">每单计提比例</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{{ fmtPrice(pool.compensation_fee) }}</div>
            <div class="stat-label">找回包赔服务费 / 单</div>
          </div>
        </div>
        <div v-else class="card"><EmptyState text="暂无资金池数据" /></div>
        <div v-if="pool" class="card card-pad">
          <div class="muted small">
            赔付资金池按每笔「找回包赔服务费」的计提比例自动归集，用于买家找回理赔的平台先行赔付。
            理赔通过时若池余额不足，平台仍先行垫付并记录缺口（见运营通知）。
          </div>
        </div>
      </template>

      <!-- 鉴号专家审核 -->
      <template v-else-if="tab === 'experts'">
        <div class="card card-pad mb16">
          <span class="muted small">共 {{ experts.length }} 条 · 通过后进入试鉴定，完成考核单数自动转正；鉴号分成按平台参数 expert_share 结算（在「管理后台-系统设置」调整）</span>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>ID</th><th>用户</th><th>手机号</th><th>游戏</th><th>状态</th>
                <th>试鉴定</th><th>资历证明</th><th>申请时间</th><th style="width:230px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in experts" :key="e.id">
                <td class="muted">#{{ e.id }}</td>
                <td><b>{{ e.nickname || `#${e.user_id}` }}</b></td>
                <td class="muted">{{ e.phone || '-' }}</td>
                <td>{{ e.game_name || '-' }}</td>
                <td><span class="badge" :class="EXPERT_STATUS[e.status]?.badge">{{ EXPERT_STATUS[e.status]?.label || e.status }}</span></td>
                <td>{{ e.trial_done || 0 }} 单</td>
                <td>
                  <div class="row wrap" style="gap:4px">
                    <img v-for="(u, i) in (e.qual_images || []).slice(0, 3)" :key="i" :src="u" class="thumb" loading="lazy" />
                    <span v-if="!e.qual_images?.length" class="muted small">无</span>
                    <span v-else-if="e.qual_images.length > 3" class="muted small">等 {{ e.qual_images.length }} 张</span>
                  </div>
                </td>
                <td class="muted">{{ fmtDateTime(e.created_at) }}</td>
                <td>
                  <div v-if="e.status === 'applying'" class="row wrap" style="gap:6px">
                    <button class="btn btn-primary btn-sm" @click="openReview('expert', e, 'approve')">通过(试鉴定)</button>
                    <button class="btn btn-ghost btn-sm" @click="openReview('expert', e, 'approve_direct')">直接签约</button>
                    <button class="btn btn-danger-ghost btn-sm" @click="openReview('expert', e, 'reject')">驳回</button>
                  </div>
                  <div v-else-if="['trial', 'approved'].includes(e.status)" class="row" style="gap:6px">
                    <button class="btn btn-danger-ghost btn-sm" @click="openReview('expert', e, 'suspend')">暂停</button>
                  </div>
                  <div v-else-if="e.status === 'suspended'" class="row" style="gap:6px">
                    <button class="btn btn-primary btn-sm" @click="openReview('expert', e, 'approve')">恢复(试鉴定)</button>
                  </div>
                  <span v-else class="muted small">—</span>
                </td>
              </tr>
              <tr v-if="!experts.length">
                <td colspan="9"><EmptyState text="暂无专家申请记录" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 退款裁决 -->
      <template v-else-if="tab === 'refunds'">
        <div class="card card-pad mb16">
          <div class="row wrap" style="gap:10px">
            <span class="muted small">状态筛选</span>
            <select v-model="refundFilter" class="select" style="width:180px">
              <option value="open">退款相关（全部）</option>
              <option value="seller_appealed">申诉待裁决</option>
              <option value="refunding">退款申请中</option>
              <option value="all">全部安全交易订单</option>
            </select>
            <span class="muted small">共 {{ refundOrders.length }} 单 · 仅「申诉待裁决」可裁决：同意退款=申诉失败，全额退款买家；驳回退款=申诉成立，交接继续</span>
          </div>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>订单号</th><th>游戏 / 区服</th><th>账号（脱敏）</th><th>金额</th><th>状态</th>
                <th>退款原因</th><th>买家</th><th>卖家</th><th>申请时间</th><th style="width:170px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in refundOrders" :key="o.id">
                <td><b>{{ o.order_no }}</b></td>
                <td>{{ o.game_name || '-' }}<div class="muted small">{{ o.server_name || '-' }}</div></td>
                <td class="muted">{{ o.account_mask || '-' }}</td>
                <td>
                  <b>{{ fmtPrice(o.total) }}</b>
                  <div class="muted small">价款 {{ fmtPrice(o.price) }} · 包赔 {{ fmtPrice(o.compensation_fee || 0) }} · 鉴号 {{ fmtPrice(o.appraisal_fee || 0) }}</div>
                </td>
                <td><span class="badge" :class="REFUND_STATUS[o.status]?.badge">{{ REFUND_STATUS[o.status]?.label || o.status }}</span></td>
                <td class="muted" style="max-width:180px">{{ o.refund_reason || '-' }}</td>
                <td>{{ o.buyer_real_name || '-' }}<div class="muted small">UID #{{ o.buyer_id }}</div></td>
                <td>{{ o.seller_real_name || '-' }}<div class="muted small">UID #{{ o.seller_id }}</div></td>
                <td class="muted">{{ fmtDateTime(o.refund_requested_at || o.created_at) }}</td>
                <td>
                  <div v-if="o.status === 'seller_appealed'" class="row" style="gap:6px">
                    <button class="btn btn-primary btn-sm" @click="openReview('refund', o, 'refund')">同意退款</button>
                    <button class="btn btn-danger-ghost btn-sm" @click="openReview('refund', o, 'continue')">驳回退款</button>
                  </div>
                  <span v-else-if="o.status === 'refunding'" class="muted small">卖家申诉窗口中</span>
                  <span v-else class="muted small">—</span>
                </td>
              </tr>
              <tr v-if="!refundOrders.length">
                <td colspan="10"><EmptyState text="暂无退款相关订单" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 维权案管理 -->
      <template v-else-if="tab === 'rights'">
        <div class="card card-pad mb16">
          <div class="row wrap" style="gap:10px">
            <span class="muted small">状态筛选</span>
            <select v-model="rightsStatusFilter" class="select" style="width:180px" @change="loadTab('rights')">
              <option value="pending_verify">待平台核验</option>
              <option value="filed">核验成立·已立案</option>
              <option value="rejected">核验未通过</option>
              <option value="docs_ready">文书已生成</option>
              <option value="submitted">已递交</option>
              <option value="in_progress">办理中</option>
              <option value="closed_done">已结案</option>
              <option value="closed">已关闭</option>
              <option value="">全部</option>
            </select>
            <span class="muted small">共 {{ rights.length }} 案 · 点击行可展开查看证据文书列表；核验成立将冻结卖家钱包等额资金</span>
          </div>
        </div>
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>案号</th><th>订单</th><th>买家</th><th>卖家</th><th>主张损失</th><th>冻结金额</th>
                <th>状态</th><th>维权诉求</th><th>申请时间</th><th style="min-width:190px">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in rights" :key="row.id">
                <tr style="cursor:pointer" @click="toggleRightsRow(row)">
                  <td class="muted">#{{ row.id }}</td>
                  <td><b>{{ row.order_summary?.order_no || `订单#${row.order_id}` }}</b><div class="muted small">{{ row.order_summary?.game_name || '-' }}</div></td>
                  <td class="muted">UID #{{ row.buyer_id }}</td>
                  <td class="muted">UID #{{ row.seller_id }}</td>
                  <td>{{ fmtPrice(row.loss) }}</td>
                  <td><span v-if="row.freeze_amount > 0" class="badge badge-danger">{{ fmtPrice(row.freeze_amount) }}</span><span v-else class="muted">—</span></td>
                  <td>
                    <span class="badge" :class="rightsStatus(row.status).badge">{{ rightsStatus(row.status).label }}</span>
                    <div v-if="row.status === 'rejected' && row.reject_reason" class="muted small" style="max-width:150px">{{ row.reject_reason }}</div>
                    <div v-else-if="row.case_no" class="muted small">案号 {{ row.case_no }}</div>
                  </td>
                  <td>
                    <span v-for="ct in row.claim_types" :key="ct" class="badge badge-primary" style="margin-right:4px">{{ claimTypeLabel(ct) }}</span>
                  </td>
                  <td class="muted">{{ fmtDateTime(row.created_at) }}</td>
                  <td>
                    <div class="row wrap" style="gap:6px">
                      <template v-if="row.status === 'pending_verify'">
                        <button class="btn btn-primary btn-sm" @click.stop="openVerify(row, 'pass')">核验成立</button>
                        <button class="btn btn-danger-ghost btn-sm" @click.stop="openVerify(row, 'reject')">核验驳回</button>
                      </template>
                      <template v-else-if="['filed', 'docs_ready', 'submitted', 'in_progress'].includes(row.status)">
                        <button class="btn btn-ghost btn-sm" @click.stop="certIssue(row)">签发存证证明</button>
                      </template>
                      <button v-if="row.freeze_amount > 0" class="btn btn-danger-ghost btn-sm" @click.stop="unfreezeCase(row)">解除冻结</button>
                      <span v-if="['closed', 'closed_done', 'rejected'].includes(row.status)" class="muted small">—</span>
                    </div>
                  </td>
                </tr>
                <tr v-if="rightsDetail?.case?.id === row.id">
                  <td colspan="10" style="background:var(--bg,#f7f8fc)">
                    <div v-if="rightsDetailLoading === row.id" class="muted small">文书加载中…</div>
                    <template v-else>
                      <div class="card-title" style="margin-bottom:6px">维权案 #{{ row.id }} · 证据文书（{{ (rightsDetail.documents || []).length }} 份）</div>
                      <div v-if="rightsDetail.documents?.length" class="row wrap" style="gap:8px">
                        <div v-for="doc in rightsDetail.documents" :key="doc.id" class="card card-pad" style="padding:8px 12px">
                          <b>{{ RIGHTS_DOC_KIND[doc.kind] || doc.title }}</b>
                          <span class="muted small"> · {{ fmtDateTime(doc.created_at) }}</span>
                          <button class="btn btn-ghost btn-sm" style="margin-left:8px" @click.stop="viewRightsDoc(row.id, doc)">查看/打印</button>
                        </div>
                      </div>
                      <span v-else class="muted small">该案暂无已生成文书</span>
                      <div class="muted small" style="margin-top:8px">
                        证据包 {{ (rightsDetail.evidence || []).length }} 项 · 事件 {{ (rightsDetail.events || []).length }} 条 ·
                        找回时间 {{ fmtDateTime(rightsDetail.case.recover_at) }} · 场景：{{ rightsDetail.case.scenario || '—' }}
                      </div>
                    </template>
                  </td>
                </tr>
              </template>
              <tr v-if="!rights.length">
                <td colspan="10"><EmptyState text="当前筛选下暂无维权案" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 派出所数据管理 -->
      <template v-else-if="tab === 'police'">
        <div class="card card-pad mb16">
          <div class="row wrap" style="gap:10px; align-items:center">
            <span class="small"><b>实时补充查询（高德）</b> 当前状态：<span v-if="amapEnabled" class="badge badge-success">已启用</span><span v-else class="badge badge-warning">未启用</span></span>
            <input v-model="amapKey" class="input" style="width:260px" maxlength="64" placeholder="粘贴高德 Web 服务 Key（留空并保存=关闭）" />
            <button class="btn btn-primary btn-sm" :disabled="amapSaving" @click="saveAmapKey">{{ amapSaving ? '保存中…' : '保存 Key' }}</button>
            <span class="muted small">在 <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener">高德开放平台</a> 免费申请，服务平台选「Web服务」；结果仅展示不落库</span>
          </div>
        </div>
        <div class="card card-pad mb16">
          <div class="row wrap" style="gap:10px; align-items:center">
            <input v-model="policeKeyword" class="input" style="width:200px" placeholder="按名称/地址搜索" @keyup.enter="searchPolice" />
            <select v-model="policeProvince" class="select" style="width:140px" @change="searchPolice">
              <option value="">全部省份</option>
              <option v-for="p in policeProvinces" :key="p" :value="p">{{ p }}</option>
            </select>
            <button class="btn btn-ghost btn-sm" @click="searchPolice">检索</button>
            <span class="muted small">共 {{ policeTotal }} 条 · 演示数据以官方公布为准</span>
            <button class="btn btn-primary btn-sm" style="margin-left:auto" @click="openPoliceEdit(null)">＋ 新建派出所</button>
          </div>
        </div>
        <div class="card table-wrap mb16">
          <table class="table">
            <thead>
              <tr>
                <th>ID</th><th>名称</th><th>省 / 市 / 区</th><th>地址</th><th>电话</th>
                <th>工作时间</th><th>来源</th><th>时效</th><th style="width:90px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in policeList" :key="s.id">
                <td class="muted">#{{ s.id }}</td>
                <td><b>{{ s.name }}</b><div v-if="s.officer" class="muted small">民警 {{ s.officer }}{{ s.officer_badge ? `（${s.officer_badge}）` : '' }}</div></td>
                <td class="muted">{{ s.province }} / {{ s.city || '-' }} / {{ s.district || '-' }}</td>
                <td class="muted" style="max-width:220px">{{ s.address || '-' }}</td>
                <td class="muted">{{ s.phone || '-' }}</td>
                <td class="muted small">{{ s.hours || '-' }}</td>
                <td class="muted small">{{ s.source || '-' }}</td>
                <td><span v-if="s.stale" class="badge badge-warning">待核实</span><span v-else class="badge badge-success">较新</span></td>
                <td><button class="btn btn-ghost btn-sm" @click="openPoliceEdit(s)">编辑</button></td>
              </tr>
              <tr v-if="!policeList.length">
                <td colspan="9"><EmptyState text="暂无派出所数据" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <Pagination :page="policePage" :total="policeTotal" :size="policeSize" @change="p => { policePage = p; loadPolice(); }" />

        <div class="card card-pad">
          <div class="card-title" style="margin-bottom:8px">用户纠错反馈（{{ feedbacks.length }} 条）</div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>ID</th><th>派出所</th><th>纠错内容</th><th>状态</th><th>提交时间</th><th style="width:120px">操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="f in feedbacks" :key="f.id">
                  <td class="muted">#{{ f.id }}</td>
                  <td>{{ f.station_name || `#${f.station_id}` }}</td>
                  <td class="muted" style="max-width:280px">{{ f.issue }}</td>
                  <td>
                    <span v-if="f.status === 'resolved'" class="badge badge-success">已核实修正</span>
                    <span v-else class="badge badge-warning">待处理</span>
                    <div v-if="f.fix_note" class="muted small">{{ f.fix_note }}</div>
                  </td>
                  <td class="muted">{{ fmtDateTime(f.created_at) }}</td>
                  <td>
                    <button v-if="f.status !== 'resolved'" class="btn btn-primary btn-sm" @click="openResolve(f)">已核实修正</button>
                    <span v-else class="muted small">—</span>
                  </td>
                </tr>
                <tr v-if="!feedbacks.length">
                  <td colspan="6"><EmptyState text="暂无纠错反馈" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- 审核/裁决确认弹窗 -->
      <Modal v-if="reviewModal" :title="reviewTitle" @close="reviewModal = null">
        <p style="margin-bottom:12px">{{ reviewDesc }}</p>
        <div v-if="showReason" class="form-item">
          <label class="form-label">
            {{ ['reject', 'continue'].includes(reviewModal.action) ? '驳回原因' : '裁决说明' }}
            <span v-if="reasonRequired" class="req">*</span>
          </label>
          <textarea v-model="reviewReason" class="textarea" :placeholder="reasonPlaceholder"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" :disabled="reviewSubmitting" @click="reviewModal = null">取消</button>
          <button
            class="btn"
            :class="reviewPrimary ? 'btn-primary' : 'btn-danger'"
            :disabled="reviewSubmitting"
            @click="submitReview"
          >{{ reviewSubmitting ? '提交中…' : '确认' }}</button>
        </template>
      </Modal>

      <!-- 理赔详情弹窗 -->
      <Modal v-if="claimDetail" title="理赔单详情" wide @close="claimDetail = null">
        <div class="form-item">
          <div class="card-title" style="margin-bottom:6px">基本信息</div>
          <div class="muted small">
            理赔单 #{{ claimDetail.id }} · 订单 {{ claimDetail.order_no || '-' }} · 成交价款 {{ fmtPrice(claimDetail.price) }}
            · 状态 <span class="badge" :class="CLAIM_STATUS[claimDetail.status]?.badge">{{ CLAIM_STATUS[claimDetail.status]?.label || claimDetail.status }}</span>
            · 申请于 {{ fmtDateTime(claimDetail.created_at) }}
          </div>
        </div>
        <div class="form-item">
          <div class="card-title" style="margin-bottom:6px">买家时间线描述</div>
          <div class="pre-wrap">{{ claimDetail.timeline_text || '-' }}</div>
        </div>
        <div class="form-item">
          <div class="card-title" style="margin-bottom:6px">AI 初核建议</div>
          <div class="ai-box">{{ claimDetail.ai_advice || '等待 AI 初核…' }}</div>
        </div>
        <div class="form-item">
          <div class="card-title" style="margin-bottom:6px">证据（{{ (claimDetail.evidence || []).length }} 项）</div>
          <div v-if="claimDetail.evidence?.length" class="row wrap" style="gap:8px">
            <template v-for="(e, i) in claimDetail.evidence" :key="i">
              <a v-if="isImgSrc(evSrc(e))" :href="evSrc(e)" target="_blank" rel="noopener">
                <img :src="evSrc(e)" class="thumb-lg" loading="lazy" />
              </a>
              <span v-else class="badge">{{ evText(e) }}</span>
            </template>
          </div>
          <span v-else class="muted small">无证据</span>
        </div>
        <div v-if="['approved', 'rejected'].includes(claimDetail.status)" class="form-item">
          <div class="card-title" style="margin-bottom:6px">裁决结果（只读）</div>
          <div class="muted small">
            {{ claimDetail.status === 'approved' ? `已赔付 ${fmtPrice(claimDetail.payout_amount)}` : '已驳回' }}
            · {{ claimDetail.decision || '无说明' }} · {{ fmtDateTime(claimDetail.decided_at) }}
          </div>
        </div>
        <template #foot>
          <template v-if="['submitted', 'reviewing'].includes(claimDetail.status)">
            <button class="btn btn-danger-ghost" @click="openReview('claim', claimDetail, 'reject'); claimDetail = null">驳回理赔</button>
            <button class="btn btn-primary" @click="openReview('claim', claimDetail, 'approve'); claimDetail = null">通过赔付</button>
          </template>
          <button class="btn btn-ghost" @click="claimDetail = null">关闭</button>
        </template>
      </Modal>

      <!-- 维权案核验弹窗 -->
      <Modal v-if="verifyModal" :title="verifyModal.action === 'pass' ? `核验成立：立案并冻结卖家资金（维权案 #${verifyModal.case.id}）` : `核验驳回（维权案 #${verifyModal.case.id}）`" @close="verifyModal = null">
        <div class="muted small" style="margin-bottom:12px">
          订单 {{ verifyModal.case.order_summary?.order_no || `#${verifyModal.case.order_id}` }} · 买家主张损失 {{ fmtPrice(verifyModal.case.loss) }} · 场景：{{ verifyModal.case.scenario || '—' }}
        </div>
        <div v-if="verifyModal.action === 'pass'" class="form-item">
          <label class="form-label">冻结金额（元）</label>
          <input v-model="verifyForm.freeze_amount" class="input" type="number" min="0" step="0.01" />
          <div class="form-hint">默认按买家主张损失冻结卖家钱包等额资金；卖家余额不足时按可用余额部分冻结，结案后自动解除</div>
        </div>
        <div v-else class="form-item">
          <label class="form-label">驳回理由 <span class="req">*</span></label>
          <textarea v-model="verifyForm.reject_reason" class="textarea" placeholder="如：交接日志显示买家已完成换绑且可正常登录，暂无被找回证据"></textarea>
          <div class="form-hint">驳回理由将通知买家，买家可补充证据后重新申请</div>
        </div>
        <template #foot>
          <button class="btn btn-ghost" :disabled="verifySubmitting" @click="verifyModal = null">取消</button>
          <button
            class="btn"
            :class="verifyModal.action === 'pass' ? 'btn-primary' : 'btn-danger'"
            :disabled="verifySubmitting"
            @click="submitVerify"
          >{{ verifySubmitting ? '提交中…' : verifyModal.action === 'pass' ? '确认立案并冻结' : '确认驳回' }}</button>
        </template>
      </Modal>

      <!-- 派出所新建/编辑弹窗 -->
      <Modal v-if="policeEdit" :title="policeEdit.id ? `编辑派出所 #${policeEdit.id}` : '新建派出所'" wide @close="policeEdit = null">
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">名称 <span class="req">*</span></label>
            <input v-model="policeEdit.name" class="input" placeholder="如：朝阳区公安分局三里屯派出所" />
          </div>
          <div class="form-item">
            <label class="form-label">省份 <span class="req">*</span></label>
            <input v-model="policeEdit.province" class="input" placeholder="如：北京市" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">城市</label>
            <input v-model="policeEdit.city" class="input" />
          </div>
          <div class="form-item">
            <label class="form-label">区县</label>
            <input v-model="policeEdit.district" class="input" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">地址</label>
            <input v-model="policeEdit.address" class="input" />
          </div>
          <div class="form-item">
            <label class="form-label">电话</label>
            <input v-model="policeEdit.phone" class="input" placeholder="报警/值班电话" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">社区民警</label>
            <input v-model="policeEdit.officer" class="input" />
          </div>
          <div class="form-item">
            <label class="form-label">警号</label>
            <input v-model="policeEdit.officer_badge" class="input" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">管辖范围</label>
            <input v-model="policeEdit.jurisdiction" class="input" />
          </div>
          <div class="form-item">
            <label class="form-label">工作时间</label>
            <input v-model="policeEdit.hours" class="input" placeholder="如：全天 / 工作日 9:00-17:00" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">经度（可选）</label>
            <input v-model="policeEdit.lng" class="input" type="number" step="0.000001" />
          </div>
          <div class="form-item">
            <label class="form-label">纬度（可选）</label>
            <input v-model="policeEdit.lat" class="input" type="number" step="0.000001" />
          </div>
        </div>
        <div class="form-item">
          <label class="form-label">数据来源</label>
          <input v-model="policeEdit.source" class="input" />
          <div class="form-hint">保存后该条数据的「待核实」标记将清除</div>
        </div>
        <template #foot>
          <button class="btn btn-ghost" :disabled="policeSaving" @click="policeEdit = null">取消</button>
          <button class="btn btn-primary" :disabled="policeSaving" @click="savePolice">{{ policeSaving ? '保存中…' : '保存' }}</button>
        </template>
      </Modal>

      <!-- 纠错反馈核实修正弹窗 -->
      <Modal v-if="resolveModal" :title="`处理纠错反馈 #${resolveModal.id}`" @close="resolveModal = null">
        <div class="muted small" style="margin-bottom:12px">
          派出所：{{ resolveModal.station_name || `#${resolveModal.station_id}` }} · 提交于 {{ fmtDateTime(resolveModal.created_at) }}
        </div>
        <div class="form-item">
          <div class="card-title" style="margin-bottom:6px">用户反馈内容</div>
          <div class="pre-wrap">{{ resolveModal.issue }}</div>
        </div>
        <div class="form-item">
          <label class="form-label">修正备注（可选）</label>
          <textarea v-model="resolveText" class="textarea" placeholder="如：电话已更新为 010-xxxx；核实无误无需修改"></textarea>
          <div class="form-hint">确认后将标记为「已核实修正」，并刷新该派出所数据时效以消除「待核实」标记</div>
        </div>
        <template #foot>
          <button class="btn btn-ghost" :disabled="resolveSubmitting" @click="resolveModal = null">取消</button>
          <button class="btn btn-primary" :disabled="resolveSubmitting" @click="submitResolve">{{ resolveSubmitting ? '提交中…' : '确认已核实修正' }}</button>
        </template>
      </Modal>
    </template>
  </main>
</template>

<style scoped>
.thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #e8e9f0;
  background: #f7f8fc;
}
.thumb-lg {
  width: 120px;
  height: 120px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #e8e9f0;
  background: #f7f8fc;
}
.advice-cell {
  max-width: 340px;
  font-size: 12px;
  line-height: 1.5;
  color: #5a5f73;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pre-wrap {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 13px;
  line-height: 1.6;
}
.ai-box {
  background: #f7f8fc;
  border: 1px solid #e8e9f0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
}
</style>
