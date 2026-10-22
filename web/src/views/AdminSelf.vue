<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';

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

const loaders = {
  listings: loadListings,
  proofs: loadProofs,
  claims: loadClaims,
  risks: loadRisks,
  pool: loadPool,
  experts: loadExperts,
  refunds: loadRefunds,
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
      <div class="page-title">自营交易管理</div>
      <div class="card">
        <EmptyState icon="🔒" text="无管理员权限，请使用管理员账号登录后访问" />
      </div>
    </template>

    <template v-else>
      <div class="page-title">自营交易管理</div>
      <div class="page-sub">自营商品审核、卖家资质、找回包赔理赔裁决、退款申诉裁决、风险事件与赔付资金池</div>

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
              <option value="all">全部自营订单</option>
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
