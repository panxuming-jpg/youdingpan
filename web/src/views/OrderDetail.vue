<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, getToken } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { onNotify } from '../sse.js';
import Modal from '../components/Modal.vue';
import PayModal from '../components/PayModal.vue';

const route = useRoute();
const id = Number(route.params.id);

const data = ref(null);
const fees = ref({ pay_timeout_min: 30, auto_confirm_days: 7, guarantee_days: 180, appraisal_fee: 50 });
const loading = ref(true);
const forbidden = ref(false);
const now = ref(Date.now());
let tickTimer = null;
let msgTimer = null;
let lastMsgId = 0;

const STATUS_LABEL = {
  pending_payment: '待支付',
  paid: '已支付·待交接',
  handover: '交接中',
  await_confirm: '待确认收货',
  refunding: '退款申诉中',
  seller_appealed: '申诉待运营裁决',
  completed: '已完成',
  refunded: '已退款',
  cancelled: '已取消',
  compensated_closed: '已赔付关闭',
};
const STATUS_BADGE = {
  pending_payment: 'badge-warning',
  paid: 'badge-primary',
  handover: 'badge-primary',
  await_confirm: 'badge-warning',
  refunding: 'badge-danger',
  seller_appealed: 'badge-danger',
  completed: 'badge-success',
  refunded: 'badge-danger',
  cancelled: 'badge',
  compensated_closed: 'badge-warning',
};
const EVIDENCE_TYPE_LABEL = {
  pay: '担保支付', ack: '协议确认', material: '账号资料', proof: '换绑凭证',
  sign: '协议签署', claim: '理赔/申诉', report: '鉴号报告', message: '会话留痕',
};
const ACTOR_LABEL = { buyer: '买家', seller: '卖家', ai: 'AI 客服', system: '系统', expert: '鉴号专家', admin: '运营' };
const RISK_TYPE_LABEL = { offsite: '站外交易引导', phishing: '钓鱼链接', credential_ask: '索要凭证话术' };
const REFUND_REASONS = ['账号与商品描述不符', '卖家超时未提交资料/不配合', '实名无法换绑', '买家原因取消交易', '其他（见说明）'];

// ---------- 加载 ----------
async function load() {
  try {
    const d = await api(`/orders/${id}`);
    data.value = d;
    forbidden.value = false;
    if (d.messages && d.messages.length) lastMsgId = Math.max(lastMsgId, ...d.messages.map(m => m.id));
  } catch (e) {
    if (e.status === 403 || e.status === 404) forbidden.value = true;
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadFees() {
  try { fees.value = await api('/self/fees'); } catch { /* 用默认值 */ }
}

// ---------- 角色与状态派生 ----------
const isBuyer = computed(() => !!data.value?.is_buyer);
const isSeller = computed(() => !!data.value && data.value.seller_id === store.user?.id);
const myRole = computed(() => (isBuyer.value ? 'buyer' : isSeller.value ? 'seller' : 'system'));
const step = computed(() => data.value?.handover_step || 0);
const status = computed(() => data.value?.status || '');
const inHandover = computed(() => status.value === 'handover');
const archived = computed(() => ['completed', 'refunded', 'cancelled', 'compensated_closed'].includes(status.value));
const canChat = computed(() => !archived.value && (isBuyer.value || isSeller.value));
const hasAcked = computed(() => !!data.value?.acks?.includes(myRole.value));
const plan = computed(() => data.value?.plan || null);
const needSellerSign = computed(() =>
  isSeller.value && plan.value?.status === 'pending_seller');

// ---------- 倒计时 ----------
const payDeadline = computed(() =>
  data.value && status.value === 'pending_payment'
    ? (data.value.created_at || 0) + fees.value.pay_timeout_min * 60_000 : 0);
const autoConfirmAt = computed(() =>
  data.value && status.value === 'await_confirm' && data.value.auto_confirm_at ? data.value.auto_confirm_at : 0);
function countdownText(deadline) {
  if (!deadline) return '';
  const ms = Math.max(0, deadline - now.value);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d > 0) return `${d} 天 ${h} 时 ${m} 分`;
  if (h > 0) return `${h} 时 ${m} 分 ${s} 秒`;
  return `${m} 分 ${s} 秒`;
}

// ---------- 支付（托管支付） ----------
const payOrder = ref(null);
async function openPay() {
  // 优先恢复下单时创建的托管支付单
  const no = data.value.pay_order_no;
  if (no) {
    try {
      const p = await api(`/pay/orders/${no}`);
      if (p && p.status === 'pending') {
        payOrder.value = p;
        return;
      }
      if (p && p.status === 'paid') {
        toast.info('该订单已支付，正在刷新状态');
        load();
        return;
      }
      toast.error('支付单已关闭或超时，请取消订单后重新下单');
      return;
    } catch (e) {
      toast.error(e.message);
      return;
    }
  }
  payOrder.value = {
    order_no: data.value.order_no,
    subject: `自营订单 ${data.value.order_no}（${data.value.listing?.account_mask || ''}）担保支付`,
    amount: data.value.total,
    expire_at: payDeadline.value || Date.now() + fees.value.pay_timeout_min * 60_000,
  };
}
function onPaySuccess() {
  payOrder.value = null;
  toast.success('支付成功，货款已进入平台托管，交接流程已开启');
  load();
}

// ---------- 加购鉴号（步骤 4） ----------
const appraising = ref(false);
async function buyAppraisal() {
  if (appraising.value) return;
  appraising.value = true;
  try {
    const d = await api(`/orders/${id}/appraise`, { method: 'POST' });
    payOrder.value = {
      order_no: d.pay_order,
      subject: `订单 ${data.value.order_no} 加购鉴号服务`,
      amount: d.amount,
      expire_at: Date.now() + 15 * 60_000,
    };
  } catch (e) {
    toast.error(e.message);
  } finally {
    appraising.value = false;
  }
}

// ---------- 步骤 1：确认协议与费用 ----------
const acking = ref(false);
async function ackStep1() {
  if (acking.value) return;
  acking.value = true;
  try {
    await api(`/orders/${id}/ack-step1`, { method: 'POST' });
    toast.success('已确认协议与费用');
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    acking.value = false;
  }
}

// ---------- 步骤 1：卖家包赔协议电子签 ----------
const signChecked = ref(false);
const signing = ref(false);
async function signPlan() {
  if (!signChecked.value) return toast.error('请先勾选确认「找回即违约」条款');
  signing.value = true;
  try {
    await api(`/orders/${id}/plan/sign`, { method: 'POST', body: { accept_recovery_breach: true } });
    toast.success('包赔协议电子签署完成，协议已生效');
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    signing.value = false;
  }
}

// ---------- 步骤 2：卖家提交账号资料 ----------
const showMaterials = ref(false);
const matForm = ref({ login_account: '', login_password: '', bind_phone: '', bind_email: '', note: '' });
const matLoading = ref(false);
async function submitMaterials() {
  const f = matForm.value;
  if (!f.login_account.trim() || !f.login_password) return toast.error('账号与密码为必填');
  matLoading.value = true;
  try {
    await api(`/orders/${id}/step2-materials`, { method: 'POST', body: {
      login_account: f.login_account.trim(), login_password: f.login_password,
      bind_phone: f.bind_phone.trim(), bind_email: f.bind_email.trim(), note: f.note.trim(),
    } });
    toast.success('账号资料已提交（时间戳已留痕），请提醒买家尽快改密换绑');
    showMaterials.value = false;
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    matLoading.value = false;
  }
}

// ---------- 图片上传（步骤 3 凭证 / 理赔证据 / 资历证明共用） ----------
async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '上传失败');
  return j.data.url;
}

// ---------- 步骤 3：买家改密换绑回传凭证 ----------
const showProof = ref(false);
const proofImages = ref([]);
const proofNote = ref('');
const proofUploading = ref(false);
const proofLoading = ref(false);
async function onProofFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  proofUploading.value = true;
  try {
    for (const f of files.slice(0, 6 - proofImages.value.length)) {
      proofImages.value.push(await uploadImage(f));
    }
  } catch (err) {
    toast.error(err.message);
  } finally {
    proofUploading.value = false;
  }
}
async function submitProof() {
  if (!proofImages.value.length) return toast.error('请上传「绑定成功页」截图');
  proofLoading.value = true;
  try {
    await api(`/orders/${id}/step3-proof`, { method: 'POST', body: { images: proofImages.value, note: proofNote.value.trim() } });
    toast.success('凭证已回传，进入核验资产与确认收货阶段');
    showProof.value = false;
    proofImages.value = [];
    proofNote.value = '';
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    proofLoading.value = false;
  }
}

// ---------- 步骤 5：确认收货 ----------
async function confirmReceipt() {
  if (!confirm('确认账号资产与商品描述一致并确认收货？确认后平台将扣佣金结算给卖家，交易完成。')) return;
  try {
    await api(`/orders/${id}/confirm-receipt`, { method: 'POST' });
    toast.success('已确认收货，平台正在结算');
    await load();
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 鉴号「不符」一键取消 ----------
const badAppraisal = computed(() =>
  (data.value?.appraisals || []).find(a => ['mismatch', 'partial'].includes(a.conclusion)));
async function cancelByAppraisal() {
  if (!confirm('鉴号结论为「不符/部分不符」，取消订单将全额退款（鉴号费不退），确认？')) return;
  try {
    await api(`/orders/${id}/cancel-by-appraisal`, { method: 'POST' });
    toast.success('订单已取消，全额退款将原路退回');
    await load();
  } catch (e) {
    toast.error(e.message);
  }
}

// ---------- 退款申请 / 卖家申诉 ----------
const showRefund = ref(false);
const refundReason = ref(REFUND_REASONS[0]);
const refundNote = ref('');
const refundLoading = ref(false);
async function submitRefund() {
  const reason = refundReason.value === '其他（见说明）' ? refundNote.value.trim() : `${refundReason.value}${refundNote.value.trim() ? '：' + refundNote.value.trim() : ''}`;
  if (!reason) return toast.error('请填写退款原因');
  refundLoading.value = true;
  try {
    await api(`/orders/${id}/refund-request`, { method: 'POST', body: { reason } });
    toast.success('退款申请已提交，对方 48 小时内可申诉');
    showRefund.value = false;
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    refundLoading.value = false;
  }
}
const showAppeal = ref(false);
const appealReason = ref('');
const appealLoading = ref(false);
async function submitAppeal() {
  appealLoading.value = true;
  try {
    await api(`/orders/${id}/refund-appeal`, { method: 'POST', body: { reason: appealReason.value.trim() } });
    toast.success('申诉已提交，已转运营依据证据链裁决');
    showAppeal.value = false;
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    appealLoading.value = false;
  }
}

// ---------- 三方会话 ----------
const chatBox = ref(null);
const inputText = ref('');
const sending = ref(false);
async function pollMessages() {
  try {
    const rows = await api(`/orders/${id}/messages`, { query: { since: lastMsgId } });
    if (rows.length) {
      data.value.messages.push(...rows);
      lastMsgId = Math.max(lastMsgId, ...rows.map(m => m.id));
      scrollChat();
    }
  } catch { /* 轮询失败静默 */ }
}
function scrollChat() {
  nextTick(() => { if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight; });
}
async function sendMessage() {
  const content = inputText.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  try {
    await api(`/orders/${id}/messages`, { method: 'POST', body: { content } });
    inputText.value = '';
    await pollMessages();
  } catch (e) {
    toast.error(e.message);
  } finally {
    sending.value = false;
  }
}
function bubbleClass(m) {
  if (m.sender === 'ai') return 'msg-ai';
  if (m.sender === 'system') return 'msg-sys';
  return m.sender === myRole.value ? 'msg-mine' : 'msg-other';
}
function senderLabel(m) {
  return { buyer: '买家', seller: '卖家', ai: 'AI 客服', system: '系统' }[m.sender] || m.sender;
}

// ---------- 转人工 ----------
const showEscalate = ref(false);
const escalateReason = ref('');
const escalating = ref(false);
async function doEscalate() {
  escalating.value = true;
  try {
    await api(`/orders/${id}/escalate`, { method: 'POST', body: { reason: escalateReason.value.trim() || undefined } });
    toast.success('已转接人工客服（运营工单）');
    showEscalate.value = false;
    escalateReason.value = '';
    await pollMessages();
  } catch (e) {
    toast.error(e.message);
  } finally {
    escalating.value = false;
  }
}

// ---------- 理赔（找回包赔） ----------
const showClaim = ref(false);
const claimEvidence = ref([]);
const claimTimeline = ref('');
const claimLoading = ref(false);
const claimUploading = ref(false);
async function onClaimFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  claimUploading.value = true;
  try {
    for (const f of files.slice(0, 6 - claimEvidence.value.length)) {
      claimEvidence.value.push(await uploadImage(f));
    }
  } catch (err) {
    toast.error(err.message);
  } finally {
    claimUploading.value = false;
  }
}
async function submitClaim() {
  if (!claimEvidence.value.length) return toast.error('请上传无法登录/被找回的证据截图');
  if (claimTimeline.value.trim().length < 20) return toast.error('时间线描述过简（至少 20 字），请写清发现时间与经过');
  claimLoading.value = true;
  try {
    const d = await api('/claims', { method: 'POST', body: { order_id: id, evidence: claimEvidence.value, timeline: claimTimeline.value.trim() } });
    toast.success(`理赔单 #${d.id} 已提交，AI 初核完成，运营将在 72 小时内裁决`);
    showClaim.value = false;
    claimEvidence.value = [];
    claimTimeline.value = '';
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    claimLoading.value = false;
  }
}
// 从证据链还原理赔状态（买家提交 + 运营裁决留痕）
const claimState = computed(() => {
  const evs = (data.value?.evidence || []).filter(e => e.type === 'claim' && e.detail?.claim_id);
  const mine = evs.filter(e => e.actor === 'buyer');
  if (!mine.length) return null;
  const latest = mine[mine.length - 1];
  const claimId = latest.detail.claim_id;
  const decision = evs.find(e => e.actor === 'admin' && e.detail?.claim_id === claimId);
  if (decision?.detail?.approved) return { id: claimId, status: 'approved' };
  if (decision?.detail?.rejected) {
    const appealed = evs.some(e => e.actor === 'buyer' && e.detail?.claim_id !== claimId && e.detail?.claim_id > claimId)
      || (data.value?.evidence || []).some(e => e.actor === 'admin' && e.detail?.claim_id > claimId);
    return { id: claimId, status: 'rejected', reason: decision.detail.reason || '', appealed };
  }
  return { id: claimId, status: 'reviewing' };
});
const guaranteeDeadline = computed(() =>
  data.value?.completed_at ? data.value.completed_at + fees.value.guarantee_days * 86_400_000 : 0);
const canClaim = computed(() =>
  isBuyer.value && status.value === 'completed' && plan.value?.status === 'active'
  && guaranteeDeadline.value > now.value && !claimState.value);
const showAppealClaim = ref(false);
const appealEvidence = ref([]);
const appealTimeline = ref('');
const claimAppealLoading = ref(false);
async function onAppealFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  try {
    for (const f of files.slice(0, 6 - appealEvidence.value.length)) {
      appealEvidence.value.push(await uploadImage(f));
    }
  } catch (err) {
    toast.error(err.message);
  }
}
async function submitClaimAppeal() {
  claimAppealLoading.value = true;
  try {
    const d = await api(`/claims/${claimState.value.id}/appeal`, {
      method: 'POST',
      body: { evidence: appealEvidence.value, timeline: appealTimeline.value.trim() || undefined },
    });
    toast.success(`申诉已提交（新理赔单 #${d.id}），请等待运营复核`);
    showAppealClaim.value = false;
    appealEvidence.value = [];
    appealTimeline.value = '';
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    claimAppealLoading.value = false;
  }
}

// ---------- 证据链摘要文案 ----------
function evidenceText(e) {
  const d = e.detail || {};
  switch (e.type) {
    case 'pay': return d.created ? `订单创建，托管金额 ${fmtPrice(d.total)}` : `买家担保支付 ${fmtPrice(d.amount)}（渠道：${d.channel === 'wechat' ? '微信' : d.channel === 'alipay' ? '支付宝' : d.channel || '-'}）`;
    case 'ack': return '确认协议与费用（步骤 1）';
    case 'material': return `提交账号资料：${d.login_account}${d.bind_phone ? ' · 手机 ' + d.bind_phone : ''}${d.bind_email ? ' · 邮箱 ' + d.bind_email : ''}${d.note ? ' · ' + d.note : ''}`;
    case 'proof': return `回传换绑凭证 ${Array.isArray(d.images) ? d.images.length : 0} 张${d.note ? ' · ' + d.note : ''}`;
    case 'sign': return '完成包赔协议电子签署';
    case 'claim': return d.refund_request ? `退款申请：${d.refund_request}`
      : d.refund_appeal ? `退款申诉：${d.refund_appeal}`
      : d.approved ? `理赔 #${d.claim_id} 裁决通过，先行赔付 ${fmtPrice(d.payout)}`
      : d.rejected ? `理赔 #${d.claim_id} 被驳回：${d.reason}`
      : d.escalated ? `转人工：${d.escalated}`
      : d.claim_id ? `提交理赔申请 #${d.claim_id}：${d.timeline || ''}` : '理赔/申诉留痕';
    case 'report': return `鉴号报告 #${d.appraisal_id}：结论「${{ match: '相符', partial: '部分不符', mismatch: '不符', incapable: '无法鉴定' }[d.conclusion] || d.conclusion}」，风险 ${d.risk_level || '-'}`;
    case 'message': return `会话留痕：${(d.content || '').slice(0, 60)}`;
    default: return JSON.stringify(d);
  }
}

// ---------- 交接步骤展示 ----------
const STEP_TITLES = ['协议确认', '卖家交资料', '改密换绑', '核验资产', '确认收货', '平台结算'];
const currentHint = computed(() => {
  const hints = data.value?.step_hints || [];
  return hints[step.value] || '';
});

const offNotify = onNotify(() => { if (data.value) load(); });

onMounted(async () => {
  await Promise.all([load(), loadFees()]);
  scrollChat();
  tickTimer = setInterval(() => { now.value = Date.now(); }, 1000);
  msgTimer = setInterval(pollMessages, 4000);
});
onUnmounted(() => {
  clearInterval(tickTimer);
  clearInterval(msgTimer);
  offNotify();
});
</script>

<template>
  <main class="container page">
    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载订单中…</div>

    <div v-else-if="forbidden || !data" class="card card-pad">
      <div class="card-title">无法查看该订单</div>
      <p class="muted">仅订单买卖双方或平台运营可查看订单详情。请确认订单号，或从「我的订单」进入。</p>
    </div>

    <template v-else>
      <!-- ===== 顶部：订单概要 ===== -->
      <div class="card card-pad mb16">
        <div class="row between wrap" style="gap:12px">
          <div style="flex:1; min-width:280px">
            <div class="row wrap" style="gap:8px; align-items:center">
              <h1 style="font-size:20px; margin:0">订单 {{ data.order_no }}</h1>
              <span class="badge" :class="STATUS_BADGE[status] || 'badge-primary'">{{ STATUS_LABEL[status] || status }}</span>
              <span v-if="isBuyer" class="badge badge-primary">我是买家</span>
              <span v-else-if="isSeller" class="badge">我是卖家</span>
              <span v-else class="badge badge-warning">运营视角</span>
            </div>
            <div class="muted small mt8">
              {{ data.listing?.game_name }}<span v-if="data.listing?.server_name"> · {{ data.listing.server_name }}</span>
              · 账号 {{ data.listing?.account_mask }}
              · 下单 {{ fmtDateTime(data.created_at) }}
              <template v-if="data.paid_at"> · 支付 {{ fmtDateTime(data.paid_at) }}</template>
              <template v-if="data.completed_at"> · 完成 {{ fmtDateTime(data.completed_at) }}</template>
            </div>
            <div class="kv-list mt16" style="grid-template-columns:96px 1fr">
              <dt>商品价款</dt><dd>{{ fmtPrice(data.price) }}</dd>
              <dt>找回包赔费</dt><dd>{{ data.compensation_fee > 0 ? fmtPrice(data.compensation_fee) : '未购买' }}</dd>
              <dt>鉴号服务费</dt><dd>{{ data.appraisal_fee > 0 ? fmtPrice(data.appraisal_fee) : '未加购' }}</dd>
              <dt>实付总额</dt><dd style="font-weight:800; color:var(--danger)">{{ fmtPrice(data.total) }}</dd>
              <dt>卖家实名</dt><dd>{{ data.seller_real_name || '已实名认证' }}</dd>
              <dt>买家实名</dt><dd>{{ isBuyer ? '已实名认证（本人）' : '已实名认证' }}</dd>
            </div>
          </div>
          <div style="text-align:right; min-width:180px">
            <template v-if="payDeadline">
              <div class="small muted">担保支付剩余</div>
              <div class="cd" style="color:var(--danger)">{{ countdownText(payDeadline) }}</div>
              <div class="small muted">逾期订单自动取消</div>
              <button v-if="isBuyer" class="btn btn-primary btn-lg mt16" @click="openPay">去支付 {{ fmtPrice(data.total) }}</button>
            </template>
            <template v-else-if="autoConfirmAt">
              <div class="small muted">自动确认收货倒计时</div>
              <div class="cd" style="color:var(--warning)">{{ countdownText(autoConfirmAt) }}</div>
              <div class="small muted">{{ fees.auto_confirm_days }} 天未操作将自动确认结算</div>
            </template>
            <template v-else-if="status === 'completed'">
              <div style="font-size:26px">✅</div>
              <div class="small muted">交易已完成，货款已结算</div>
            </template>
            <template v-else-if="status === 'refunded' || status === 'cancelled'">
              <div style="font-size:26px">🚫</div>
              <div class="small" style="color:var(--danger)">{{ data.refund_reason || STATUS_LABEL[status] }}</div>
            </template>
          </div>
        </div>
        <div v-if="['refunding', 'seller_appealed'].includes(status)" class="banner-danger mt16">
          {{ status === 'refunding'
            ? `交接失败退款申请处理中（原因：${data.refund_reason}）。卖家可在 48 小时内申诉，逾期或申诉失败将全额退款。`
            : `卖家已提交申诉（原因：${data.refund_reason}），已转运营依据证据链裁决。` }}
        </div>
        <div v-if="status === 'compensated_closed'" class="banner-danger mt16">
          找回理赔成立：平台已向买家先行赔付，并冻结卖家钱包等额资金向卖家追偿（15 日）。
        </div>
      </div>

      <!-- ===== 交接六步进度 ===== -->
      <div v-if="['paid','handover','await_confirm'].includes(status) || (status === 'completed' && step >= 1)" class="card card-pad mb16">
        <div class="card-title">标准交接六步（AI 客服全程引导留痕）</div>
        <div class="steps">
          <div v-for="(t, i) in STEP_TITLES" :key="t" class="step" :class="{ done: step > i + 1 || status === 'completed', cur: step === i + 1 && status !== 'completed' }">
            <div class="step-dot">{{ step > i + 1 || status === 'completed' ? '✓' : i + 1 }}</div>
            <div class="step-title">{{ t }}</div>
          </div>
        </div>
        <p v-if="currentHint && status !== 'completed'" class="hint-bar">{{ currentHint }}</p>

        <!-- 步骤 1：双方确认 + 卖家电子签 -->
        <template v-if="step === 1 && inHandover">
          <div class="row wrap mt16" style="gap:10px; align-items:center">
            <span class="badge" :class="data.acks.includes('buyer') ? 'badge-success' : ''">买家：{{ data.acks.includes('buyer') ? '已确认' : '待确认' }}</span>
            <span class="badge" :class="data.acks.includes('seller') ? 'badge-success' : ''">卖家：{{ data.acks.includes('seller') ? '已确认' : '待确认' }}</span>
            <button v-if="(isBuyer || isSeller) && !hasAcked" class="btn btn-primary btn-sm" :disabled="acking" @click="ackStep1">
              {{ acking ? '提交中…' : '确认协议与费用' }}
            </button>
            <span v-else-if="hasAcked" class="small muted">我已确认，等待另一方确认</span>
          </div>
          <div v-if="data.compensation_fee > 0 && !plan" class="small muted mt8">包赔协议将在买家支付完成后生成，请买家尽快完成担保支付。</div>

          <!-- 卖家包赔协议电子签 -->
          <div v-if="needSellerSign" class="terms-box mt16">
            <div class="card-title">{{ plan.terms?.title || '找回包赔服务协议' }}</div>
            <div class="small muted mb16">
              买家 {{ plan.terms?.buyer_name || '' }}（{{ plan.terms?.buyer_id_mask || '' }}） · 卖家 {{ plan.terms?.seller_name || '' }}（{{ plan.terms?.seller_id_mask || '' }}）
              · 账号 {{ plan.terms?.account_mask || '' }} · 保障期 {{ plan.terms?.guarantee_days || fees.guarantee_days }} 天 · 赔付上限 {{ fmtPrice(plan.terms?.payout_cap || data.price) }}
            </div>
            <ol class="terms-list">
              <li v-for="(t, i) in plan.terms?.terms || []" :key="i">{{ t }}</li>
            </ol>
            <p class="small" style="color:var(--danger)">{{ plan.terms?.forced_notice || '本协议为平台服务承诺，非保险产品。' }}</p>
            <div v-if="plan.sign_deadline" class="small muted mb16">签署截止：{{ fmtDateTime(plan.sign_deadline) }}（逾期订单将自动退款关闭）</div>
            <label class="check-row mb16">
              <input v-model="signChecked" type="checkbox" />
              我已阅读并确认「找回即违约」条款：本人发起或协助找回已售账号即构成根本违约，接受平台冻结钱包、永久违约标记与依法追偿。
            </label>
            <button class="btn btn-primary" :disabled="signing || !signChecked" @click="signPlan">{{ signing ? '签署中…' : '电子签署包赔协议' }}</button>
          </div>
        </template>

        <!-- 步骤 2：卖家提交资料 -->
        <template v-if="step === 2 && inHandover">
          <div class="mt16">
            <button v-if="isSeller && !showMaterials" class="btn btn-primary" @click="showMaterials = true">提交账号资料</button>
            <span v-else-if="!isSeller" class="small muted">已提醒卖家提交账号资料，请留意会话消息。</span>
          </div>
        </template>

        <!-- 步骤 3：买家改密换绑 -->
        <template v-if="step === 3 && inHandover">
          <div class="mt16">
            <button v-if="isBuyer && !showProof" class="btn btn-primary" @click="showProof = true">回传改密换绑凭证</button>
            <span v-else-if="!isBuyer" class="small muted">请买家尽快修改密码、换绑手机/邮箱并回传「绑定成功页」截图。</span>
          </div>
        </template>

        <!-- 步骤 4/5：核验资产 + 确认收货 -->
        <template v-if="step >= 4 && ['handover', 'await_confirm'].includes(status)">
          <div class="row wrap mt16" style="gap:10px">
            <template v-if="isBuyer">
              <button class="btn btn-ghost btn-sm" @click="buyAppraisal" :disabled="appraising">
                {{ appraising ? '处理中…' : `加购鉴号服务（${fmtPrice(fees.appraisal_fee ?? 50)}）` }}
              </button>
              <button v-if="step >= 4" class="btn btn-primary" @click="confirmReceipt">确认收货</button>
              <button v-if="badAppraisal" class="btn btn-danger-ghost" @click="cancelByAppraisal">鉴号不符 · 一键取消全额退款</button>
            </template>
            <span v-else-if="isSeller" class="small muted">买家正在核验资产，确认收货后平台将自动结算到您的钱包。</span>
          </div>
        </template>

        <!-- 退款申请入口（任一方可发起） -->
        <div v-if="['paid','handover','await_confirm'].includes(status) && (isBuyer || isSeller)" class="mt16">
          <button class="btn btn-danger-ghost btn-sm" @click="showRefund = true">交接失败 · 申请退款</button>
          <button v-if="isSeller && status === 'refunding'" class="btn btn-ghost btn-sm" style="margin-left:8px" @click="showAppeal = true">我要申诉（48h 内）</button>
        </div>
      </div>

      <!-- ===== 三方会话 ===== -->
      <div class="card card-pad mb16">
        <div class="row between wrap" style="gap:8px; margin-bottom:12px">
          <div class="card-title" style="margin:0">三方会话（买家 + 卖家 + AI 客服 · 全程留痕）</div>
          <div class="row" style="gap:8px">
            <button v-if="canChat" class="btn btn-ghost btn-sm" @click="showEscalate = true">转人工</button>
          </div>
        </div>
        <div ref="chatBox" class="chat">
          <div v-for="m in data.messages" :key="m.id" class="msg" :class="bubbleClass(m)">
            <div class="msg-meta">
              <span class="msg-sender">{{ senderLabel(m) }}</span>
              <span>{{ fmtDateTime(m.created_at) }}</span>
              <span v-if="m.meta?.level === 'danger'" class="msg-risk">风险预警</span>
            </div>
            <div class="msg-bubble">{{ m.content }}</div>
          </div>
          <div v-if="!data.messages.length" class="muted small" style="padding:12px 0">会话暂无消息</div>
        </div>
        <div v-if="canChat" class="row mt16" style="gap:8px">
          <input v-model="inputText" class="input" style="flex:1" maxlength="1000" placeholder="输入消息，AI 客服与对方均可见…" @keydown.enter.prevent="sendMessage" />
          <button class="btn btn-primary" :disabled="sending || !inputText.trim()" @click="sendMessage">{{ sending ? '发送中…' : '发送' }}</button>
        </div>
        <div v-else-if="archived" class="small muted mt8">订单会话已归档（只读），全部记录已固化至证据链。</div>
      </div>

      <!-- ===== 理赔（找回包赔） ===== -->
      <div v-if="isBuyer && status === 'completed'" class="card card-pad mb16">
        <div class="card-title">找回包赔 · 保障服务</div>
        <template v-if="plan && plan.status === 'active'">
          <div class="row between wrap" style="gap:8px">
            <span class="badge badge-success">包赔协议生效中</span>
            <span class="small muted">保障期至 {{ guaranteeDeadline ? fmtDateTime(guaranteeDeadline) : '-' }}（确认收货起 {{ fees.guarantee_days }} 天）</span>
          </div>
          <template v-if="!claimState">
            <p class="small muted mt16">账号若被卖家或第三方找回，可在此提交证据申请平台先行赔付。</p>
            <button class="btn btn-primary btn-sm mt8" @click="showClaim = true">发起理赔申请</button>
          </template>
          <template v-else-if="claimState.status === 'reviewing'">
            <p class="mt16 small">理赔单 #{{ claimState.id }} 已提交，AI 初核完成，运营将在 72 小时内裁决，请留意会话与站内消息。</p>
          </template>
          <template v-else-if="claimState.status === 'approved'">
            <p class="mt16 small" style="color:var(--success)">理赔单 #{{ claimState.id }} 审核通过，平台已先行赔付到您的钱包。</p>
          </template>
          <template v-else-if="claimState.status === 'rejected'">
            <p class="mt16 small" style="color:var(--danger)">理赔单 #{{ claimState.id }} 被驳回：{{ claimState.reason }}</p>
            <button v-if="!claimState.appealed" class="btn btn-ghost btn-sm mt8" @click="showAppealClaim = true">补充证据申诉（仅一次）</button>
            <span v-else class="small muted mt8">申诉机会已使用。</span>
          </template>
        </template>
        <p v-else class="small muted">该订单未购买或未生效找回包赔服务。若账号被找回，可通过「转人工」提交证据由运营依据证据链处理。</p>
      </div>

      <!-- ===== 鉴号报告 ===== -->
      <div v-if="data.appraisals.length" class="card card-pad mb16">
        <div class="card-title">鉴号报告（{{ data.appraisals.length }}）</div>
        <div v-for="a in data.appraisals" :key="a.id" class="report-item">
          <div class="row wrap" style="gap:8px; align-items:center">
            <b>鉴号单 #{{ a.id }}</b>
            <span class="badge" :class="{ match: 'badge-success', partial: 'badge-warning', mismatch: 'badge-danger', incapable: '' }[a.conclusion] || 'badge-primary'">
              {{ a.report?.conclusion_label || { match: '相符', partial: '部分不符', mismatch: '不符', incapable: '无法鉴定' }[a.conclusion] || a.status }}
            </span>
            <span v-if="a.status === 'pending_payment'" class="badge badge-warning">待支付</span>
            <span v-else-if="a.status === 'pending_accept'" class="badge badge-warning">等待专家接单</span>
            <span v-else-if="a.status === 'in_progress'" class="badge badge-primary">鉴定中（24h 内出报告）</span>
            <span v-else-if="a.status === 'reassigned'" class="badge">已转单重鉴</span>
            <span class="small muted">鉴号费 {{ fmtPrice(a.fee) }} · {{ fmtDateTime(a.created_at) }}</span>
          </div>
          <template v-if="a.report">
            <div v-if="a.report.items?.length" class="table-wrap mt8">
              <table class="table">
                <thead><tr><th>核对项</th><th>卖家填报</th><th>实际核验</th><th>结论</th></tr></thead>
                <tbody>
                  <tr v-for="(it, i) in a.report.items" :key="i">
                    <td>{{ it.name }}</td><td>{{ it.claimed }}</td><td>{{ it.actual }}</td>
                    <td><span class="badge" :class="it.match ? 'badge-success' : 'badge-danger'">{{ it.match ? '相符' : '不符' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="small mt8">找回风险等级：{{ { low: '低', mid: '中', high: '高' }[a.report.risk_level] || a.report.risk_level || '-' }}</div>
            <div v-if="a.report.advice" class="small muted mt8">专家建议：{{ a.report.advice }}</div>
            <div v-if="a.report.incapable_reason" class="small muted mt8">无法鉴定原因：{{ a.report.incapable_reason === 'seller_uncooperative' ? '卖家不配合（按不符处理）' : '专家能力不足（转单重鉴）' }}</div>
          </template>
        </div>
      </div>

      <!-- ===== AI 估值快照 ===== -->
      <div v-if="data.valuation_snapshot" class="card card-pad mb16">
        <div class="card-title">下单时点 AI 估值快照（固化留痕）</div>
        <div class="kv-list">
          <dt>估值区间</dt><dd>{{ fmtPrice(data.valuation_snapshot.low) }} ~ {{ fmtPrice(data.valuation_snapshot.high) }}（中点 {{ fmtPrice(data.valuation_snapshot.mid) }}）</dd>
          <dt>性价比分</dt><dd>{{ data.valuation_snapshot.score ?? '-' }} / 100</dd>
          <dt>置信度</dt><dd>{{ { high: '高', mid: '中', low: '低' }[data.valuation_snapshot.confidence] || '-' }}</dd>
        </div>
      </div>

      <!-- ===== 风险事件 ===== -->
      <div v-if="data.risks.length" class="card card-pad mb16">
        <div class="card-title" style="color:var(--danger)">风险事件（{{ data.risks.length }}）</div>
        <div v-for="r in data.risks" :key="r.id" class="risk-item">
          <span class="badge badge-danger">{{ RISK_TYPE_LABEL[r.type] || r.type }}</span>
          <span class="small" style="flex:1; word-break:break-all">{{ r.detail }}</span>
          <span class="small muted">{{ fmtDateTime(r.created_at) }}</span>
        </div>
      </div>

      <!-- ===== 证据链时间线 ===== -->
      <div class="card card-pad">
        <div class="card-title">证据链时间线（只可追加、不可编辑，理赔与纠纷唯一依据）</div>
        <div v-if="data.evidence.length" class="timeline">
          <div v-for="e in data.evidence" :key="e.id" class="tl-item">
            <div class="tl-dot"></div>
            <div class="tl-body">
              <div class="row wrap" style="gap:8px; align-items:center">
                <span class="badge badge-primary">{{ EVIDENCE_TYPE_LABEL[e.type] || e.type }}</span>
                <span class="small">{{ ACTOR_LABEL[e.actor] || e.actor }}</span>
                <span class="small muted">{{ fmtDateTime(e.created_at) }}</span>
              </div>
              <div class="small tl-detail">{{ evidenceText(e) }}</div>
            </div>
          </div>
        </div>
        <div v-else class="muted small">暂无证据记录</div>
      </div>

      <!-- ===== 弹窗们 ===== -->
      <PayModal v-if="payOrder" :pay-order="payOrder" @close="payOrder = null" @success="onPaySuccess" />

      <Modal v-if="showMaterials" title="步骤 2 · 提交账号资料（仅交接必需，平台留痕）" @close="showMaterials = false">
        <div class="form-item">
          <label class="form-label">登录账号 <span class="req">*</span></label>
          <input v-model="matForm.login_account" class="input" placeholder="游戏/平台登录账号" />
        </div>
        <div class="form-item">
          <label class="form-label">登录密码 <span class="req">*</span></label>
          <input v-model="matForm.login_password" class="input" type="password" placeholder="当前密码，供买家改密使用" />
          <div class="form-hint">买家改密后此密码即刻失效；请勿在会话中重复发送密码</div>
        </div>
        <div class="form-item">
          <label class="form-label">绑定手机</label>
          <input v-model="matForm.bind_phone" class="input" placeholder="当前绑定手机号（可换绑）" />
        </div>
        <div class="form-item">
          <label class="form-label">绑定邮箱</label>
          <input v-model="matForm.bind_email" class="input" placeholder="当前绑定邮箱（可换绑）" />
        </div>
        <div class="form-item">
          <label class="form-label">补充说明</label>
          <textarea v-model="matForm.note" class="textarea" rows="3" placeholder="二次验证方式、登录设备、注意事项等"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="showMaterials = false">取消</button>
          <button class="btn btn-primary" :disabled="matLoading" @click="submitMaterials">{{ matLoading ? '提交中…' : '提交资料并留痕' }}</button>
        </template>
      </Modal>

      <Modal v-if="showProof" title="步骤 3 · 回传改密换绑凭证" @close="showProof = false">
        <p class="small muted mb16">请上传「绑定成功页」/「改密成功」截图（1-6 张），系统将记入证据链并开启自动确认倒计时。</p>
        <div class="row wrap" style="gap:8px; margin-bottom:12px">
          <div v-for="(u, i) in proofImages" :key="u" class="thumb">
            <img :src="u" alt="凭证" />
            <button class="thumb-x" title="移除" @click="proofImages.splice(i, 1)">×</button>
          </div>
        </div>
        <label class="btn btn-ghost btn-sm">
          {{ proofUploading ? '上传中…' : '上传截图' }}
          <input type="file" accept="image/*" multiple hidden :disabled="proofUploading" @change="onProofFile" />
        </label>
        <div class="form-item mt16">
          <label class="form-label">备注</label>
          <textarea v-model="proofNote" class="textarea" rows="2" placeholder="如：已改密码并换绑至本人手机 138****"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="showProof = false">取消</button>
          <button class="btn btn-primary" :disabled="proofLoading || !proofImages.length" @click="submitProof">{{ proofLoading ? '提交中…' : '提交凭证' }}</button>
        </template>
      </Modal>

      <Modal v-if="showRefund" title="申请退款（交接失败）" @close="showRefund = false">
        <div class="form-item">
          <label class="form-label">退款原因 <span class="req">*</span></label>
          <select v-model="refundReason" class="select">
            <option v-for="r in REFUND_REASONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="form-label">补充说明</label>
          <textarea v-model="refundNote" class="textarea" rows="3" placeholder="请说明具体情况，运营将依据证据链裁决"></textarea>
        </div>
        <p class="small muted">提交后订单进入退款申诉窗口，卖家可在 48 小时内申诉；逾期或申诉失败将全额退款。</p>
        <template #foot>
          <button class="btn btn-ghost" @click="showRefund = false">取消</button>
          <button class="btn btn-danger" :disabled="refundLoading" @click="submitRefund">{{ refundLoading ? '提交中…' : '提交退款申请' }}</button>
        </template>
      </Modal>

      <Modal v-if="showAppeal" title="卖家申诉（转运营裁决）" @close="showAppeal = false">
        <div class="form-item">
          <label class="form-label">申诉理由</label>
          <textarea v-model="appealReason" class="textarea" rows="3" placeholder="请说明交接正常/退款申请不成立的理由与证据"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="showAppeal = false">取消</button>
          <button class="btn btn-primary" :disabled="appealLoading" @click="submitAppeal">{{ appealLoading ? '提交中…' : '提交申诉' }}</button>
        </template>
      </Modal>

      <Modal v-if="showEscalate" title="转人工客服" @close="showEscalate = false">
        <div class="form-item">
          <label class="form-label">问题描述（可选）</label>
          <textarea v-model="escalateReason" class="textarea" rows="3" placeholder="请简述需要人工介入的问题，运营将依据会话与证据链摘要处理"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="showEscalate = false">取消</button>
          <button class="btn btn-primary" :disabled="escalating" @click="doEscalate">{{ escalating ? '提交中…' : '确认转人工' }}</button>
        </template>
      </Modal>

      <Modal v-if="showClaim" title="发起找回理赔申请" wide @close="showClaim = false">
        <p class="small muted mb16">请上传无法登录/账号被找回的证据截图（登录失败页、绑定变更通知等），并填写时间线描述（何时发现、经过、与卖家沟通情况）。</p>
        <div class="row wrap" style="gap:8px; margin-bottom:12px">
          <div v-for="(u, i) in claimEvidence" :key="u" class="thumb">
            <img :src="u" alt="证据" />
            <button class="thumb-x" title="移除" @click="claimEvidence.splice(i, 1)">×</button>
          </div>
        </div>
        <label class="btn btn-ghost btn-sm">
          {{ claimUploading ? '上传中…' : '上传证据截图' }}
          <input type="file" accept="image/*" multiple hidden :disabled="claimUploading" @change="onClaimFile" />
        </label>
        <div class="form-item mt16">
          <label class="form-label">时间线描述 <span class="req">*</span></label>
          <textarea v-model="claimTimeline" class="textarea" rows="5" placeholder="例：10月1日起登录提示密码错误；10月3日收到绑定变更短信，非本人操作；已尝试官方申诉找回失败…"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="showClaim = false">取消</button>
          <button class="btn btn-primary" :disabled="claimLoading" @click="submitClaim">{{ claimLoading ? '提交中…' : '提交理赔（AI 初核 + 运营 72h 裁决）' }}</button>
        </template>
      </Modal>

      <Modal v-if="showAppealClaim" title="理赔驳回申诉（仅一次机会）" @close="showAppealClaim = false">
        <div class="form-item">
          <label class="form-label">补充证据截图</label>
          <input type="file" accept="image/*" multiple @change="onAppealFile" />
        </div>
        <div v-if="appealEvidence.length" class="small muted">已选 {{ appealEvidence.length }} 张</div>
        <div class="form-item mt16">
          <label class="form-label">申诉说明</label>
          <textarea v-model="appealTimeline" class="textarea" rows="4" placeholder="针对驳回理由补充说明与新证据（留空则沿用原描述）"></textarea>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="showAppealClaim = false">取消</button>
          <button class="btn btn-primary" :disabled="claimAppealLoading" @click="submitClaimAppeal">{{ claimAppealLoading ? '提交中…' : '提交申诉' }}</button>
        </template>
      </Modal>
    </template>
  </main>
</template>

<style scoped>
.cd { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
.banner-danger {
  background: var(--danger-weak, #fef2f2); border: 1px solid var(--danger);
  color: var(--danger); border-radius: 10px; padding: 10px 14px; font-size: 13px;
}
.steps { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
.step { flex: 1; min-width: 84px; text-align: center; position: relative; }
.step-dot {
  width: 28px; height: 28px; line-height: 28px; border-radius: 50%; margin: 0 auto 6px;
  background: var(--bg); border: 2px solid var(--border); color: var(--text3); font-weight: 700; font-size: 13px;
}
.step.done .step-dot { background: var(--success); border-color: var(--success); color: #fff; }
.step.cur .step-dot { background: var(--primary); border-color: var(--primary); color: #fff; }
.step-title { font-size: 12px; color: var(--text3); }
.step.done .step-title, .step.cur .step-title { color: var(--text); font-weight: 600; }
.hint-bar {
  margin-top: 12px; background: var(--primary-weak, #eef2ff); border-radius: 8px;
  padding: 10px 12px; font-size: 13px; color: var(--text2);
}
.terms-box { border: 1px solid var(--border); border-radius: 10px; padding: 14px; background: #fff; }
.terms-list { margin: 8px 0 8px 18px; padding: 0; font-size: 13px; color: var(--text2); line-height: 1.8; }
.chat { max-height: 420px; min-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px; background: var(--bg); border-radius: 10px; }
.msg { display: flex; flex-direction: column; max-width: 78%; }
.msg-mine { align-self: flex-end; align-items: flex-end; }
.msg-other, .msg-ai { align-self: flex-start; }
.msg-sys { align-self: center; align-items: center; }
.msg-meta { font-size: 11px; color: var(--text3); margin-bottom: 3px; display: flex; gap: 8px; }
.msg-sender { font-weight: 700; }
.msg-bubble {
  padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.6;
  background: #fff; border: 1px solid var(--border); word-break: break-word; white-space: pre-wrap;
}
.msg-mine .msg-bubble { background: var(--primary); color: #fff; border-color: var(--primary); }
.msg-ai .msg-bubble { background: var(--primary-weak, #eef2ff); }
.msg-sys .msg-bubble { background: transparent; border: none; color: var(--text3); font-size: 12px; }
.msg-risk { color: var(--danger); font-weight: 700; }
.timeline { position: relative; padding-left: 6px; }
.tl-item { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--border); }
.tl-item:last-child { border-bottom: none; }
.tl-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--primary); margin-top: 6px; flex: none; }
.tl-body { flex: 1; }
.tl-detail { margin-top: 4px; color: var(--text2); word-break: break-all; }
.risk-item { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--border); flex-wrap: wrap; }
.risk-item:last-child { border-bottom: none; }
.report-item { padding: 10px 0; border-bottom: 1px dashed var(--border); }
.report-item:last-child { border-bottom: none; }
.thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-x {
  position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border: none;
  border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; cursor: pointer; line-height: 1;
}
</style>
