<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, getToken } from '../api.js';
import { toast } from '../toast.js';
import { fmtPrice, fmtDateTime, RIGHTS_SCENARIOS, RIGHTS_CLAIM_TYPES } from '../utils.js';

const route = useRoute();
const router = useRouter();
const orderId = Number(route.query.order_id) || 0;

const order = ref(null);
const loading = ref(true);
const invalid = ref('');

// ---------- 表单 ----------
function toLocalInput(ts) {
  const d = new Date(ts);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const form = ref({
  recover_at: toLocalInput(Date.now()),
  scenario: RIGHTS_SCENARIOS[0],
  other_note: '',
  loss: '',
  contacted_seller: false,
  claim_types: ['civil'],
});
const materials = ref([]);
const uploading = ref(false);
const submitting = ref(false);

const canSubmit = computed(() =>
  order.value && form.value.recover_at && Number(form.value.loss) > 0 && form.value.claim_types.length);

function toggleClaim(key) {
  const i = form.value.claim_types.indexOf(key);
  if (i >= 0) form.value.claim_types.splice(i, 1);
  else form.value.claim_types.push(key);
}

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

async function onMaterialFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const remain = 9 - materials.value.length;
  if (remain <= 0) return toast.error('自证材料最多 9 张');
  uploading.value = true;
  let ok = 0;
  for (const f of files.slice(0, remain)) {
    if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} 超过 5MB`); continue; }
    try {
      materials.value.push(await uploadImage(f));
      ok++;
    } catch (err) {
      toast.error(`${f.name} 上传失败：${err.message}`);
    }
  }
  uploading.value = false;
  if (ok) toast.success(`已上传 ${ok} 张自证材料`);
}

async function submit() {
  if (!canSubmit.value) return;
  const scenario = form.value.scenario === '其他'
    ? `其他：${form.value.other_note.trim()}`
    : form.value.scenario;
  if (form.value.scenario === '其他' && !form.value.other_note.trim()) return toast.error('请填写「其他」情形说明');
  submitting.value = true;
  try {
    const d = await api('/rights/apply', {
      method: 'POST',
      body: {
        order_id: orderId,
        recover_at: new Date(form.value.recover_at).getTime(),
        scenario,
        loss: Number(form.value.loss),
        contacted_seller: form.value.contacted_seller ? 1 : 0,
        materials: materials.value,
        claim_types: form.value.claim_types,
      },
    });
    toast.success(`维权案 #${d.case_id} 已提交，平台将在 72 小时内完成证据核验`);
    router.replace(`/rights/${d.case_id}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  if (!orderId) {
    invalid.value = '缺少订单参数，请从订单详情发起维权';
    loading.value = false;
    return;
  }
  try {
    const d = await api(`/orders/${orderId}`);
    if (!d.is_buyer) {
      invalid.value = '仅订单买家本人可发起追账号维权';
    } else if (d.status !== 'completed') {
      invalid.value = '仅「交易完成」的担保订单可申请追账号维权（交接失败请走退款/理赔流程）';
    } else {
      order.value = d;
      form.value.loss = String(d.total);
    }
  } catch (e) {
    invalid.value = e.message || '订单不存在';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="container page">
    <div class="page-title">发起追账号维权</div>
    <div class="page-sub">平台将归集订单合同、担保支付流水、六步交接日志与三方会话作为证据包，核验成立后协助生成民事起诉状 / 报案材料包</div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载订单中…</div>

    <div v-else-if="invalid" class="card card-pad">
      <div class="card-title">无法发起维权</div>
      <p class="muted">{{ invalid }}</p>
      <div class="row mt16">
        <button class="btn btn-primary" @click="router.push('/orders')">返回我的订单</button>
        <button class="btn btn-ghost" @click="router.push('/rights')">我的维权案</button>
      </div>
    </div>

    <template v-else>
      <div class="detail-grid">
        <div class="card card-pad">
          <div class="card-title">① 找回事件</div>
          <div class="form-item">
            <label class="form-label">发现账号被找回的时间 <span class="req">*</span></label>
            <input v-model="form.recover_at" type="datetime-local" class="input" />
            <div class="form-hint">以您实际发现无法登录 / 绑定被改的时间为准</div>
          </div>
          <div class="form-item">
            <label class="form-label">找回情形 <span class="req">*</span></label>
            <div style="display:flex; flex-direction:column; gap:8px">
              <label v-for="s in RIGHTS_SCENARIOS" :key="s" class="check-row">
                <input v-model="form.scenario" type="radio" name="scenario" :value="s" /> {{ s }}
              </label>
            </div>
            <input v-if="form.scenario === '其他'" v-model="form.other_note" class="input mt8" maxlength="200" placeholder="请说明其他情形，如：账号被原注册人通过实名申诉强制找回" />
          </div>
          <div class="form-item">
            <label class="form-label">主张损失金额（元）<span class="req">*</span></label>
            <input v-model="form.loss" type="number" min="0.01" step="0.01" class="input" />
            <div class="form-hint">默认按订单实付总额填写，可按实际损失调整（含后续充值损失等，需在材料中自证）</div>
          </div>
          <div class="form-item">
            <label class="form-label">是否已联系卖家</label>
            <label class="check-row">
              <input v-model="form.contacted_seller" type="checkbox" /> 已联系过卖家交涉（建议在订单会话中留痕，将一并计入证据包）
            </label>
          </div>

          <div class="card-title mt16">② 维权诉求（可多选）</div>
          <div class="row wrap" style="gap:10px">
            <span
              v-for="c in RIGHTS_CLAIM_TYPES"
              :key="c.key"
              class="chip"
              :class="{ active: form.claim_types.includes(c.key) }"
              @click="toggleClaim(c.key)"
            >{{ c.label }}</span>
          </div>
          <div class="form-hint">民事起诉：生成起诉状向被告住所地/合同履行地法院递交；刑事报案：涉诈可报案并拨打 96110；先走包赔：符合包赔协议条件的可同步申请平台先行赔付</div>

          <div class="card-title mt16">③ 自证材料（登录失败页 / 绑定变更通知 / 申诉记录截图，最多 9 张）</div>
          <div class="img-grid">
            <div v-for="(img, idx) in materials" :key="img" class="img-ph" style="position:relative">
              <img :src="img" alt="自证材料" style="width:100%;height:100%;object-fit:contain" />
              <button class="btn btn-sm btn-ghost" style="position:absolute;top:4px;right:4px" @click="materials.splice(idx, 1)">×</button>
            </div>
            <label v-if="materials.length < 9" class="img-ph" style="cursor:pointer">
              <input type="file" accept="image/*" multiple hidden :disabled="uploading" @change="onMaterialFile" />
              <span v-if="uploading">上传中…</span>
              <span v-else>+ 上传截图</span>
            </label>
          </div>

          <button class="btn btn-primary btn-lg mt16" :disabled="!canSubmit || submitting" @click="submit">
            {{ submitting ? '提交中…' : '提交维权申请（平台 72 小时内核验）' }}
          </button>
        </div>

        <!-- 订单摘要（只读） -->
        <div class="card card-pad" style="align-self:start">
          <div class="card-title">关联订单（只读，将自动归集为证据包）</div>
          <dl class="kv-list">
            <dt>订单号</dt><dd>{{ order.order_no }}</dd>
            <dt>游戏/区服</dt><dd>{{ order.listing?.game_name }} · {{ order.listing?.server_name }}</dd>
            <dt>账号</dt><dd>{{ order.listing?.account_mask }}</dd>
            <dt>商品价款</dt><dd>{{ fmtPrice(order.price) }}</dd>
            <dt>实付总额</dt><dd style="font-weight:700; color:var(--danger)">{{ fmtPrice(order.total) }}</dd>
            <dt>完成时间</dt><dd>{{ fmtDateTime(order.completed_at) }}</dd>
            <dt>卖家</dt><dd>{{ order.seller_real_name || '已实名认证' }}</dd>
          </dl>
          <p class="muted small mt16" style="line-height:1.7">
            证据包含：订单合同/交易快照、担保支付流水、六步交接日志、三方会话留痕、卖家实名与归属凭证。提交后不可编辑订单存证，仅可补充自证材料。
          </p>
        </div>
      </div>
    </template>
  </main>
</template>
