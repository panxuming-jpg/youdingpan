<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, getToken } from '../api.js';
import { toast } from '../toast.js';
import {
  fmtPrice, fmtDateTime, rightsStatus, claimTypeLabel, openDocWindow,
  RIGHTS_EVENT_ACTOR, RIGHTS_EVENT_TYPE, RIGHTS_DOC_KIND, RIGHTS_RESULTS,
} from '../utils.js';
import Modal from '../components/Modal.vue';

const route = useRoute();
const router = useRouter();
const caseId = Number(route.params.id);

const data = ref(null);
const loading = ref(true);
const forbidden = ref(false);

async function load() {
  try {
    data.value = await api(`/rights/${caseId}`);
    forbidden.value = false;
  } catch (e) {
    if (e.status === 403 || e.status === 404) forbidden.value = true;
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}

const c = computed(() => data.value?.case || null);
const status = computed(() => c.value?.status || '');
const canAddEvidence = computed(() => ['pending_verify', 'filed'].includes(status.value));
const canGenDoc = computed(() => ['filed', 'docs_ready', 'submitted', 'in_progress'].includes(status.value));
const canProgress = computed(() => ['filed', 'docs_ready', 'submitted', 'in_progress'].includes(status.value));
const canCancel = computed(() => !['closed', 'closed_done'].includes(status.value));
const canCert = computed(() => !['closed', 'closed_done', 'rejected'].includes(status.value));

// ---------- 补充自证材料 ----------
const showEvidence = ref(false);
const evImages = ref([]);
const evUploading = ref(false);
const evSubmitting = ref(false);

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '上传失败');
  return j.data.url;
}
async function onEvFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const remain = 9 - evImages.value.length;
  if (remain <= 0) return toast.error('单次最多补充 9 张');
  evUploading.value = true;
  for (const f of files.slice(0, remain)) {
    try {
      evImages.value.push(await uploadImage(f));
    } catch (err) {
      toast.error(`${f.name} 上传失败：${err.message}`);
    }
  }
  evUploading.value = false;
}
async function submitEvidence() {
  if (!evImages.value.length) return toast.error('请上传至少一张自证图片');
  evSubmitting.value = true;
  try {
    await api(`/rights/${caseId}/evidence`, { method: 'POST', body: { materials: evImages.value } });
    toast.success('补充材料已提交并计入证据包');
    showEvidence.value = false;
    evImages.value = [];
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    evSubmitting.value = false;
  }
}

// ---------- 生成民事起诉状 ----------
const showComplaint = ref(false);
const cmpForm = ref({ facts_edit: '', extra_claim: '', court_name: '' });
const cmpSubmitting = ref(false);
async function submitComplaint() {
  cmpSubmitting.value = true;
  try {
    const d = await api(`/rights/${caseId}/generate-complaint`, {
      method: 'POST',
      body: {
        facts_edit: cmpForm.value.facts_edit.trim() || undefined,
        extra_claim: cmpForm.value.extra_claim.trim() || undefined,
        court_name: cmpForm.value.court_name.trim() || undefined,
      },
    });
    toast.success(`民事起诉状已生成（文书 #${d.doc_id}），请打印签字后递交法院`);
    showComplaint.value = false;
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    cmpSubmitting.value = false;
  }
}

// ---------- 生成报案材料包（内嵌派出所选择） ----------
const showReport = ref(false);
const districts = ref([]);
const rpForm = ref({ province: '', city: '', district: '', keyword: '' });
const rpResults = ref(null);
const rpSearching = ref(false);
const rpStation = ref(null);
const rpSubmitting = ref(false);

async function openReportModal() {
  showReport.value = true;
  rpStation.value = null;
  if (!districts.value.length) {
    try { districts.value = await api('/police/districts'); } catch (e) { toast.error(e.message); }
  }
}
const cityOptions = computed(() =>
  districts.value.find(p => p.province === rpForm.value.province)?.cities || []);
const districtOptions = computed(() =>
  cityOptions.value.find(x => x.city === rpForm.value.city)?.districts || []);

async function searchStations() {
  rpSearching.value = true;
  try {
    rpResults.value = await api('/police/search', {
      query: {
        province: rpForm.value.province, city: rpForm.value.city,
        district: rpForm.value.district, keyword: rpForm.value.keyword, limit: 30,
      },
    });
    rpStation.value = null;
  } catch (e) {
    toast.error(e.message);
  } finally {
    rpSearching.value = false;
  }
}
async function submitReport() {
  if (!rpStation.value) return toast.error('请先检索并选择递交单位（派出所）');
  rpSubmitting.value = true;
  try {
    const d = await api(`/rights/${caseId}/generate-report-pack`, {
      method: 'POST', body: { station_id: rpStation.value.id },
    });
    toast.success(`报案材料包已生成（文书 #${d.doc_id}），请打印并附证据原件到派出所递交`);
    showReport.value = false;
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    rpSubmitting.value = false;
  }
}

// ---------- 文书查看/打印 ----------
const docLoading = ref(0);
async function viewDoc(doc) {
  docLoading.value = doc.id;
  try {
    const d = await api(`/rights/${caseId}/documents/${doc.id}`);
    if (!openDocWindow(d.html)) toast.error('新窗口被浏览器拦截，请允许弹窗后重试');
  } catch (e) {
    toast.error(e.message);
  } finally {
    docLoading.value = 0;
  }
}

// ---------- 进度回填 ----------
const progressStage = computed(() => {
  if (['filed', 'docs_ready'].includes(status.value)) return 'submitted';
  if (status.value === 'submitted') return 'in_progress';
  if (status.value === 'in_progress') return 'closed_done';
  return '';
});
const progressForm = ref({ case_no: '', note: '', result: RIGHTS_RESULTS[0] });
const progressSubmitting = ref(false);
async function submitProgress() {
  const stage = progressStage.value;
  if (!stage) return;
  if (stage === 'submitted' && !progressForm.value.case_no.trim()) return toast.error('已递交需填写案号');
  progressSubmitting.value = true;
  try {
    await api(`/rights/${caseId}/progress`, {
      method: 'POST',
      body: {
        stage,
        case_no: progressForm.value.case_no.trim() || undefined,
        note: progressForm.value.note.trim() || undefined,
        result: stage === 'closed_done'
          ? `${progressForm.value.result}${progressForm.value.note.trim() ? '：' + progressForm.value.note.trim() : ''}`
          : undefined,
      },
    });
    toast.success('进度已回填');
    progressForm.value = { case_no: '', note: '', result: RIGHTS_RESULTS[0] };
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    progressSubmitting.value = false;
  }
}

// ---------- 存证证明 / 撤销 ----------
const certSubmitting = ref(false);
async function requestCert() {
  certSubmitting.value = true;
  try {
    await api(`/rights/${caseId}/cert`, { method: 'POST' });
    toast.success('已提交申请，平台运营签发后可在文书区查看下载');
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    certSubmitting.value = false;
  }
}
async function cancelCase() {
  if (!confirm('确认撤销本维权案？撤销后卖家冻结资金将解除，已生成文书不再更新，且不可恢复。')) return;
  try {
    await api(`/rights/${caseId}/cancel`, { method: 'POST' });
    toast.success('维权案已撤销');
    await load();
  } catch (e) {
    toast.error(e.message);
  }
}

onMounted(load);
</script>

<template>
  <main class="container page">
    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载维权案…</div>

    <div v-else-if="forbidden || !c" class="card card-pad">
      <div class="card-title">无法查看该维权案</div>
      <p class="muted">仅维权案买家本人可查看。请从「我的维权案」进入。</p>
      <button class="btn btn-primary btn-sm mt8" @click="router.push('/rights')">返回我的维权案</button>
    </div>

    <template v-else>
      <!-- ===== 状态条 ===== -->
      <div class="card card-pad mb16">
        <div class="row between wrap" style="gap:12px">
          <div>
            <div class="row wrap" style="gap:8px; align-items:center">
              <h1 style="font-size:20px; margin:0">维权案 #{{ c.id }}</h1>
              <span class="badge" :class="rightsStatus(c.status).badge">{{ rightsStatus(c.status).label }}</span>
            </div>
            <div class="muted small mt8">{{ rightsStatus(c.status).hint }}</div>
            <div class="muted small" style="margin-top:4px">
              <template v-if="data.order_summary">
                订单 {{ data.order_summary.order_no }} · {{ data.order_summary.game_name }} · {{ data.order_summary.server_name }}
                · 实付 {{ fmtPrice(data.order_summary.total) }} ·
              </template>
              发起于 {{ fmtDateTime(c.created_at) }}
            </div>
          </div>
          <div style="text-align:right">
            <div class="small muted">主张损失</div>
            <div style="font-size:22px; font-weight:800; color:var(--danger)">{{ fmtPrice(c.loss) }}</div>
            <div v-if="c.freeze_amount > 0" class="badge badge-warning mt8">已冻结卖家等额资金 {{ fmtPrice(c.freeze_amount) }}</div>
          </div>
        </div>
        <div class="row wrap mt16" style="gap:6px">
          <span class="muted small">维权诉求：</span>
          <span v-for="t in c.claim_types" :key="t" class="badge badge-primary">{{ claimTypeLabel(t) }}</span>
          <span class="muted small" style="margin-left:8px">找回时间：{{ fmtDateTime(c.recover_at) }} · 情形：{{ c.scenario || '-' }} · {{ c.contacted_seller ? '已联系卖家' : '未联系卖家' }}</span>
        </div>
        <div v-if="c.status === 'rejected' && c.reject_reason" class="small mt8" style="color:var(--danger)">驳回理由：{{ c.reject_reason }}</div>
        <div v-if="c.case_no" class="small mt8">司法机关案号：<b>{{ c.case_no }}</b></div>
        <div v-if="c.result" class="small mt8">结案结果：<b>{{ c.result }}</b></div>
        <div class="row wrap mt16" style="gap:10px">
          <button v-if="canCert" class="btn btn-ghost btn-sm" :disabled="certSubmitting" @click="requestCert">
            {{ certSubmitting ? '提交中…' : '申请交易存证证明' }}
          </button>
          <button v-if="canCancel" class="btn btn-danger-ghost btn-sm" @click="cancelCase">撤销维权</button>
        </div>
      </div>

      <div class="detail-grid">
        <div style="display:flex; flex-direction:column; gap:16px; min-width:0">
          <!-- ===== 文书区 ===== -->
          <div class="card card-pad">
            <div class="card-title">维权文书</div>
            <div v-if="canGenDoc" class="row wrap mb16" style="gap:10px">
              <button class="btn btn-primary" @click="showComplaint = true">生成起诉书（民事起诉状）</button>
              <button class="btn btn-ghost" @click="openReportModal">生成报案材料包</button>
            </div>
            <p v-else-if="status === 'pending_verify'" class="muted small mb16">核验成立后即可生成民事起诉状与报案材料包。</p>
            <div v-if="data.documents.length" class="table-wrap">
              <table class="table">
                <thead><tr><th>类型</th><th>标题</th><th>生成时间</th><th style="width:110px">操作</th></tr></thead>
                <tbody>
                  <tr v-for="d in data.documents" :key="d.id">
                    <td><span class="badge badge-primary">{{ RIGHTS_DOC_KIND[d.kind] || d.kind }}</span></td>
                    <td>{{ d.title }}</td>
                    <td class="muted">{{ fmtDateTime(d.created_at) }}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" :disabled="docLoading === d.id" @click="viewDoc(d)">
                        {{ docLoading === d.id ? '打开中…' : '查看/打印' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="muted small">暂无文书</div>
          </div>

          <!-- ===== 证据包 ===== -->
          <div class="card card-pad">
            <div class="row between wrap" style="margin-bottom:10px; gap:8px">
              <div class="card-title" style="margin:0">证据包（平台交易存证自动归集，脱敏如实展示）</div>
              <button v-if="canAddEvidence" class="btn btn-ghost btn-sm" @click="showEvidence = true">补充自证材料</button>
            </div>
            <div v-if="data.evidence.length" class="table-wrap">
              <table class="table">
                <thead><tr><th>序号</th><th>证据名称</th><th>来源</th><th>内容摘要</th><th>校验码</th></tr></thead>
                <tbody>
                  <tr v-for="e in data.evidence" :key="e.seq">
                    <td class="muted">{{ e.seq }}</td>
                    <td><b>{{ e.name }}</b><div class="muted small">{{ e.time ? fmtDateTime(e.time) : '' }}</div></td>
                    <td class="muted">{{ e.source }}</td>
                    <td class="muted" style="white-space:normal; max-width:360px">{{ e.summary }}</td>
                    <td class="muted small">{{ e.hash }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="muted small">暂无证据</div>
            <div v-if="c.materials.length" class="row wrap mt16" style="gap:8px">
              <a v-for="(u, i) in c.materials" :key="u" :href="u" target="_blank" rel="noopener" class="thumb-link">
                <img :src="u" alt="自证材料" class="thumb-img" loading="lazy" />
              </a>
            </div>
          </div>

          <!-- ===== 进展回填 ===== -->
          <div v-if="canProgress" class="card card-pad">
            <div class="card-title">司法进度回填</div>
            <template v-if="progressStage === 'submitted'">
              <p class="muted small mb16">文书打印签署并递交法院/派出所后，填写受理案号推进到「已递交」。</p>
              <div class="form-row">
                <div class="form-item">
                  <label class="form-label">案号 / 受理编号 <span class="req">*</span></label>
                  <input v-model="progressForm.case_no" class="input" maxlength="60" placeholder="例：（2026）京0108民初12345号" />
                </div>
                <div class="form-item">
                  <label class="form-label">备注（可选）</label>
                  <input v-model="progressForm.note" class="input" maxlength="200" placeholder="递交单位、经办联系方式等" />
                </div>
              </div>
            </template>
            <template v-else-if="progressStage === 'in_progress'">
              <p class="muted small mb16">记录办理节点（立案/开庭/调解/侦查进展等），推进到「办理中」。</p>
              <div class="form-item">
                <label class="form-label">节点记录 <span class="req">*</span></label>
                <textarea v-model="progressForm.note" class="textarea" rows="2" maxlength="500" placeholder="例：法院已正式立案，排期 11 月开庭"></textarea>
              </div>
            </template>
            <template v-else-if="progressStage === 'closed_done'">
              <p class="muted small mb16">司法程序终结后选择结果结案；结案将自动解除卖家钱包冻结。</p>
              <div class="form-row">
                <div class="form-item">
                  <label class="form-label">结案结果 <span class="req">*</span></label>
                  <select v-model="progressForm.result" class="select">
                    <option v-for="r in RIGHTS_RESULTS" :key="r" :value="r">{{ r }}</option>
                  </select>
                </div>
                <div class="form-item">
                  <label class="form-label">结果说明（可选）</label>
                  <input v-model="progressForm.note" class="input" maxlength="200" placeholder="例：调解结案，被告分期退还购号款" />
                </div>
              </div>
            </template>
            <button class="btn btn-primary" :disabled="progressSubmitting" @click="submitProgress">
              {{ progressSubmitting ? '提交中…' :
                progressStage === 'submitted' ? '确认已递交' : (progressStage === 'in_progress' ? '记录办理节点' : '确认结案') }}
            </button>
          </div>

          <!-- ===== 时间线 ===== -->
          <div class="card card-pad">
            <div class="card-title">流程时间线（只可追加、不可编辑）</div>
            <div v-if="data.events.length" class="timeline">
              <div v-for="e in data.events" :key="e.id" class="tl-item">
                <div class="tl-dot"></div>
                <div class="tl-body">
                  <div class="row wrap" style="gap:8px; align-items:center">
                    <span class="badge badge-primary">{{ RIGHTS_EVENT_TYPE[e.type] || e.type }}</span>
                    <span class="small">{{ RIGHTS_EVENT_ACTOR[e.actor] || e.actor }}</span>
                    <span class="small muted">{{ fmtDateTime(e.created_at) }}</span>
                  </div>
                  <div class="small tl-detail">{{ e.content }}</div>
                </div>
              </div>
            </div>
            <div v-else class="muted small">暂无事件</div>
          </div>
        </div>

        <!-- ===== 右侧：卖家实名信息卡 ===== -->
        <div style="display:flex; flex-direction:column; gap:16px">
          <div class="card card-pad">
            <div class="card-title">卖家实名信息（平台实名核验存档）</div>
            <dl class="kv-list">
              <dt>真实姓名</dt><dd>{{ data.seller_real.real_name || '未实名' }}</dd>
              <dt>身份证号</dt><dd>{{ data.seller_real.id_card || '—' }}</dd>
              <dt>注册手机</dt><dd>{{ data.seller_real.phone || '—' }}</dd>
            </dl>
            <p class="small mt16" style="color:var(--warning)">
              ⚠ 仅限本次维权使用。{{ status === 'pending_verify' || status === 'rejected' ? '核验成立（立案）后将展示完整实名信息，当前为脱敏展示。' : '已立案，展示完整实名信息，请勿用于维权以外用途。' }}
            </p>
          </div>
          <div class="card card-pad">
            <div class="card-title">追回指引</div>
            <p class="muted small" style="line-height:1.8">
              报案免费；涉电信网络诈骗可拨打 <b>96110</b> 反诈专线咨询；紧急情况请拨 <b>110</b>。
              就近派出所信息与地址可在「追回指引」页检索核实。
            </p>
            <RouterLink to="/police"><button class="btn btn-ghost btn-block mt8">派出所检索 · 追回指引</button></RouterLink>
          </div>
        </div>
      </div>

      <!-- ===== 弹窗：补充自证材料 ===== -->
      <Modal v-if="showEvidence" title="补充自证材料" @close="showEvidence = false">
        <p class="small muted mb16">上传登录失败页、绑定变更通知、官方申诉记录等截图（最多 9 张），提交后计入证据包。</p>
        <div class="row wrap" style="gap:8px; margin-bottom:12px">
          <div v-for="(u, i) in evImages" :key="u" class="thumb">
            <img :src="u" alt="材料" />
            <button class="thumb-x" title="移除" @click="evImages.splice(i, 1)">×</button>
          </div>
        </div>
        <label class="btn btn-ghost btn-sm">
          {{ evUploading ? '上传中…' : '上传截图' }}
          <input type="file" accept="image/*" multiple hidden :disabled="evUploading" @change="onEvFile" />
        </label>
        <template #foot>
          <button class="btn btn-ghost" @click="showEvidence = false">取消</button>
          <button class="btn btn-primary" :disabled="evSubmitting || !evImages.length" @click="submitEvidence">{{ evSubmitting ? '提交中…' : '提交补充材料' }}</button>
        </template>
      </Modal>

      <!-- ===== 弹窗：生成起诉书 ===== -->
      <Modal v-if="showComplaint" title="生成民事起诉状" wide @close="showComplaint = false">
        <div class="form-item">
          <label class="form-label">事实陈述（可编辑，留空则按平台存证自动生成）</label>
          <textarea v-model="cmpForm.facts_edit" class="textarea" rows="6" maxlength="4000"
            placeholder="例：2026年9月1日，原告经游盯盘平台下单购买游戏账号（订单号 SO…），通过平台担保支付实付价款合计人民币 3600 元；9月3日完成六步交接并确认收货。10月8日，原告发现该账号实名被改、无法登录（场景：实名信息被改），已联系卖家交涉未果。平台交易存证可完整还原交易过程。"></textarea>
        </div>
        <div class="form-row">
          <div class="form-item">
            <label class="form-label">额外赔偿主张（可选）</label>
            <input v-model="cmpForm.extra_claim" class="input" maxlength="100" placeholder="例：账号内充值损失 800 元" />
          </div>
          <div class="form-item">
            <label class="form-label">受诉法院（可选，可生成后补填）</label>
            <input v-model="cmpForm.court_name" class="input" maxlength="100" placeholder="例：北京市海淀区人民法院" />
            <div class="form-hint">一般可选被告住所地或合同履行地法院</div>
          </div>
        </div>
        <p class="small muted">起诉状将列明双方身份信息（平台实名存档，仅限本次维权使用）、诉讼请求、事实与理由及证据清单。</p>
        <template #foot>
          <button class="btn btn-ghost" @click="showComplaint = false">取消</button>
          <button class="btn btn-primary" :disabled="cmpSubmitting" @click="submitComplaint">{{ cmpSubmitting ? '生成中…' : '生成起诉状' }}</button>
        </template>
      </Modal>

      <!-- ===== 弹窗：生成报案材料包（内嵌派出所选择） ===== -->
      <Modal v-if="showReport" title="生成报案材料包 · 选择递交单位" wide @close="showReport = false">
        <div class="form-row mb16">
          <div class="form-item">
            <label class="form-label">省</label>
            <select v-model="rpForm.province" class="select" @change="rpForm.city = ''; rpForm.district = ''">
              <option value="">全部</option>
              <option v-for="p in districts" :key="p.province" :value="p.province">{{ p.province }}</option>
            </select>
          </div>
          <div class="form-item">
            <label class="form-label">市</label>
            <select v-model="rpForm.city" class="select" :disabled="!rpForm.province" @change="rpForm.district = ''">
              <option value="">全部</option>
              <option v-for="x in cityOptions" :key="x.city" :value="x.city">{{ x.city }}</option>
            </select>
          </div>
          <div class="form-item">
            <label class="form-label">区</label>
            <select v-model="rpForm.district" class="select" :disabled="!rpForm.city">
              <option value="">全部</option>
              <option v-for="d in districtOptions" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
        </div>
        <div class="row mb16" style="gap:8px">
          <input v-model="rpForm.keyword" class="input" style="flex:1" maxlength="30" placeholder="按名称/地址关键词检索，如：中关村" @keydown.enter.prevent="searchStations" />
          <button class="btn btn-primary" :disabled="rpSearching" @click="searchStations">{{ rpSearching ? '检索中…' : '检索派出所' }}</button>
        </div>
        <div v-if="rpResults" class="rp-list">
          <div
            v-for="s in rpResults"
            :key="s.id"
            class="rp-item"
            :class="{ sel: rpStation?.id === s.id }"
            @click="rpStation = s"
          >
            <div>
              <b>{{ s.name }}</b>
              <span v-if="s.stale" class="badge badge-warning" style="margin-left:6px">待核实</span>
              <div class="muted small">{{ [s.province, s.city, s.district].filter(Boolean).join(' · ') }} · {{ s.address || '地址待核实' }}</div>
            </div>
            <span v-if="rpStation?.id === s.id" class="badge badge-success">已选</span>
          </div>
          <div v-if="!rpResults.length" class="muted small" style="padding:12px; text-align:center">未检索到派出所，请调整筛选或关键词</div>
        </div>
        <p v-else class="muted small">选择就近（案发地/居住地）公安机关派出所作为递交单位。</p>
        <template #foot>
          <button class="btn btn-ghost" @click="showReport = false">取消</button>
          <button class="btn btn-primary" :disabled="rpSubmitting || !rpStation" @click="submitReport">{{ rpSubmitting ? '生成中…' : '生成报案材料包' }}</button>
        </template>
      </Modal>
    </template>
  </main>
</template>

<style scoped>
.timeline { position: relative; padding-left: 6px; }
.tl-item { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--border); }
.tl-item:last-child { border-bottom: none; }
.tl-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--primary); margin-top: 6px; flex: none; }
.tl-body { flex: 1; }
.tl-detail { margin-top: 4px; color: var(--text2); word-break: break-all; }
.thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-x {
  position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border: none;
  border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; cursor: pointer; line-height: 1;
}
.thumb-link { display: block; }
.thumb-img {
  width: 84px; height: 84px; object-fit: cover; border-radius: 8px;
  border: 1px solid var(--border); display: block; background: #f5f6fa;
}
.rp-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.rp-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  border: 1px solid var(--border-strong); border-radius: 10px; padding: 10px 12px;
  cursor: pointer; transition: all 0.15s;
}
.rp-item:hover { border-color: var(--primary); }
.rp-item.sel { border-color: var(--primary); background: var(--primary-weak); }
</style>
