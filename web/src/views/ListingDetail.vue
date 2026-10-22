<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { fmtPrice, fmtDateTime } from '../utils.js';
import { toast } from '../toast.js';
import { store } from '../store.js';
import EmptyState from '../components/EmptyState.vue';
import PayModal from '../components/PayModal.vue';

const route = useRoute();
const router = useRouter();

const detail = ref(null);
const fees = ref(null);
const loading = ref(true);
const failed = ref(false);
const errorMsg = ref('');

const assetLabels = ref({});
const explain = ref({ loading: false, text: '' });

const withComp = ref(false);
const withAppr = ref(false);
const ordering = ref(false);
const payOrder = ref(null);
const createdOrder = ref(null); // { order_id, order_no, total }

const CONF_LABEL = { high: '高置信', mid: '中置信', low: '低置信' };
const buyable = computed(() => detail.value && detail.value.status === 'on');
const estTotal = computed(() => {
  if (!detail.value) return 0;
  const comp = withComp.value && detail.value.support_compensation && fees.value ? fees.value.compensation_fee : 0;
  const appr = withAppr.value && fees.value ? fees.value.appraisal_fee : 0;
  return detail.value.price + comp + appr;
});
const assetRows = computed(() => {
  if (!detail.value) return [];
  return Object.entries(detail.value.assets || {}).map(([k, v]) => [assetLabels.value[k] || k, String(v)]);
});
const showRaw = computed(() => {
  const d = detail.value;
  if (!d || !d.can_view_raw || !d.raw_images || !d.raw_images.length) return false;
  const imgs = d.images || [];
  return imgs.length !== d.raw_images.length || imgs[0] !== d.raw_images[0];
});

async function loadDetail() {
  loading.value = true;
  failed.value = false;
  errorMsg.value = '';
  try {
    detail.value = await api(`/self/listings/${route.params.id}`);
    withComp.value = !!detail.value.support_compensation;
    loadExplain();
  } catch (e) {
    failed.value = true;
    errorMsg.value = e.message || '商品不存在';
  } finally {
    loading.value = false;
  }
}

async function loadFees() {
  try {
    fees.value = await api('/self/fees');
  } catch { /* 费率拿不到时以下单返回实付为准 */ }
}

async function loadTemplates() {
  try {
    const games = await api('/seller/templates');
    const g = (games || []).find(x => detail.value && x.id === detail.value.game_id);
    assetLabels.value = Object.fromEntries((g?.asset_template || []).map(t => [t.key, t.label]));
  } catch { /* 标签映射失败则直接展示字段名 */ }
}

async function loadExplain() {
  explain.value.loading = true;
  try {
    const d = await api(`/self/listings/${route.params.id}/explain`, { method: 'POST' });
    explain.value.text = d.text || '';
  } catch { /* 解读失败静默，展示估值备注 */ } finally {
    explain.value.loading = false;
  }
}

async function submitOrder() {
  if (!buyable.value || ordering.value) return;
  if (!store.token) {
    toast.info('请先登录后再下单');
    router.push({ path: '/login', query: { redirect: route.fullPath } });
    return;
  }
  ordering.value = true;
  try {
    const d = await api('/orders', {
      method: 'POST',
      body: {
        listing_id: detail.value.id,
        with_compensation: withComp.value && !!detail.value.support_compensation,
        with_appraisal: withAppr.value,
      },
    });
    createdOrder.value = d;
    // 下单返回的 pay_order 为支付单号，取完整支付单信息供收银台使用
    try {
      payOrder.value = await api(`/pay/orders/${d.pay_order}`);
    } catch {
      payOrder.value = { order_no: d.pay_order, subject: `自营订单 ${d.order_no}`, amount: d.total, expire_at: Date.now() + 30 * 60_000 };
    }
  } catch (e) {
    toast.error(e.message);
  } finally {
    ordering.value = false;
  }
}

async function onPaySuccess() {
  payOrder.value = null;
  toast.success('支付成功，货款已由平台担保托管，AI 客服已开启交接流程');
  if (createdOrder.value) router.push(`/orders/${createdOrder.value.order_id}`);
}

function onPayClose() {
  payOrder.value = null;
  // 下单后商品已锁定，取消支付回到详情时刷新状态
  loadDetail();
}

onMounted(async () => {
  await loadDetail();
  loadFees();
  if (detail.value) loadTemplates();
});
</script>

<template>
  <main class="container page">
    <div class="row mb16" style="gap:6px; color:var(--text2); font-size:13px">
      <RouterLink to="/self" style="color:var(--primary)">自营市场</RouterLink>
      <span>/</span>
      <span>自营商品详情</span>
    </div>

    <div v-if="loading" class="loading-box"><div class="spinner"></div>加载中…</div>

    <div v-else-if="failed || !detail" class="card">
      <EmptyState :text="errorMsg || '商品不存在或已下架'">
        <RouterLink to="/self"><button class="btn btn-primary btn-sm">返回自营市场</button></RouterLink>
      </EmptyState>
    </div>

    <div v-else class="detail-grid">
      <div style="display:flex; flex-direction:column; gap:16px">
        <!-- 基本信息与价格 -->
        <div class="card card-pad">
          <div class="row wrap" style="gap:6px; margin-bottom:10px">
            <span class="badge badge-primary">平台自营 · 担保交易</span>
            <span class="badge">{{ detail.game_name }}</span>
            <span class="badge">{{ detail.server_name }}</span>
            <span v-if="detail.channel" class="badge">{{ detail.channel }}</span>
            <span v-if="detail.verified" class="badge badge-success">已验归属</span>
            <span v-if="detail.support_compensation" class="badge badge-success">支持找回包赔</span>
            <span v-if="detail.status === 'locked'" class="badge badge-danger">交易中已锁定</span>
            <span v-else-if="detail.status !== 'on'" class="badge badge-danger">已下架</span>
          </div>
          <h1 style="font-size:20px; font-weight:700; line-height:1.5; margin-bottom:12px">
            {{ detail.game_name }}账号 · {{ detail.account_mask }}
          </h1>
          <div class="price-block">
            <span class="price-current">{{ fmtPrice(detail.price) }}</span>
            <span v-if="detail.valuation" class="muted small">AI 估值区间 {{ fmtPrice(detail.valuation.low) }} - {{ fmtPrice(detail.valuation.high) }}</span>
          </div>
          <div class="price-lowest mt8">
            卖家：<b>{{ detail.seller_name || '—' }}</b>
            <span v-if="detail.listed_at" style="margin-left:12px">上架于 {{ fmtDateTime(detail.listed_at) }}</span>
          </div>
        </div>

        <!-- 展示图组（生成图优先，卖家/管理员可看原始截图） -->
        <div v-if="detail.images && detail.images.length" class="card card-pad">
          <div class="card-title">标准化展示图（{{ detail.images.length }} 张）</div>
          <div class="img-grid">
            <a v-for="(img, i) in detail.images" :key="i" :href="img" target="_blank" rel="noopener" class="img-ph img-ph-link">
              <img :src="img" :alt="`展示图 ${i + 1}`" loading="lazy" />
            </a>
          </div>
          <p class="form-hint mt8">展示图由平台按标准化模板生成，账号资产以图组与结构化信息为准。</p>

          <template v-if="showRaw">
            <div class="card-title mt16">卖家原始截图（{{ detail.raw_images.length }} 张）</div>
            <div class="img-grid">
              <a v-for="(img, i) in detail.raw_images" :key="`r${i}`" :href="img" target="_blank" rel="noopener" class="img-ph img-ph-link">
                <img :src="img" :alt="`原始截图 ${i + 1}`" loading="lazy" />
              </a>
            </div>
          </template>
        </div>

        <!-- 资产信息 -->
        <div class="card card-pad">
          <div class="card-title">账号资产信息</div>
          <dl v-if="assetRows.length" class="kv-list">
            <dt>游戏</dt><dd>{{ detail.game_name }}</dd>
            <dt>区服</dt><dd>{{ detail.server_name }}{{ detail.channel ? ' · ' + detail.channel : '' }}</dd>
            <dt>账号标识</dt><dd>{{ detail.account_id || detail.account_mask }}</dd>
            <template v-for="[label, value] in assetRows" :key="label">
              <dt>{{ label }}</dt><dd>{{ value }}</dd>
            </template>
          </dl>
          <p v-else class="muted small">卖家未填写结构化资产字段。</p>
          <p v-if="detail.description" class="muted mt16" style="white-space:pre-wrap; line-height:1.8; font-size:13px">{{ detail.description }}</p>
        </div>

        <!-- AI 估值卡 -->
        <div class="card card-pad">
          <div class="row between" style="margin-bottom:10px">
            <div class="card-title" style="margin-bottom:0">AI 估值与性价比</div>
            <span v-if="detail.valuation" class="badge" :class="detail.valuation.confidence === 'low' ? 'badge-warning' : 'badge-success'">
              {{ CONF_LABEL[detail.valuation.confidence] || '' }}
            </span>
          </div>
          <template v-if="detail.valuation">
            <div class="row wrap" style="gap:18px; margin-bottom:12px">
              <div>
                <div class="muted small">估值区间</div>
                <div style="font-size:18px; font-weight:800">{{ fmtPrice(detail.valuation.low) }} - {{ fmtPrice(detail.valuation.high) }}</div>
              </div>
              <div>
                <div class="muted small">估值中点</div>
                <div style="font-size:18px; font-weight:800; color:var(--primary)">{{ fmtPrice(detail.valuation.mid) }}</div>
              </div>
              <div>
                <div class="muted small">性价比分</div>
                <div style="font-size:18px; font-weight:800; color:var(--danger)">{{ detail.valuation.score }}<span class="small muted" style="font-weight:400"> / 100</span></div>
              </div>
            </div>
            <div v-if="detail.valuation.basis && detail.valuation.basis.length" class="mb16">
              <div v-for="(b, i) in detail.valuation.basis" :key="i" class="row" style="gap:8px; align-items:flex-start; margin-bottom:6px">
                <span class="badge badge-primary" style="flex:none">{{ i + 1 }}</span>
                <div style="font-size:13px"><b>{{ b.name }}</b><span class="muted"> · {{ b.desc }}</span></div>
              </div>
            </div>
            <div class="card" style="background:var(--bg); border:none; padding:12px 14px">
              <div v-if="explain.loading" class="muted small"><span class="spinner" style="display:inline-block; width:14px; height:14px; vertical-align:-2px"></span> 正在生成估值解读…</div>
              <p v-else-if="explain.text" style="font-size:13px; line-height:1.8">{{ explain.text }}</p>
              <p v-else class="muted small" style="line-height:1.8">{{ detail.valuation.note || '暂无解读说明' }}</p>
            </div>
            <p class="form-hint mt8">估值由大模型基于成交样本与挂牌价分布生成，仅供参考，不构成价格承诺。</p>
          </template>
          <p v-else class="muted small">该商品暂无估值数据（上架后自动生成）。</p>
        </div>

        <!-- 历史鉴号报告 -->
        <div v-if="detail.appraisals && detail.appraisals.length" class="card card-pad">
          <div class="card-title">历史鉴号报告（{{ detail.appraisals.length }} 份）</div>
          <div v-for="a in detail.appraisals" :key="a.id" class="row between" style="padding:8px 0; border-bottom:1px dashed var(--border)">
            <div>
              <span class="badge" :class="a.conclusion === 'match' ? 'badge-success' : a.conclusion === 'partial' ? 'badge-warning' : 'badge-danger'">{{ a.conclusion_label }}</span>
              <span v-if="a.report && a.report.summary" class="muted small" style="margin-left:8px">{{ a.report.summary }}</span>
            </div>
            <span class="muted small">{{ fmtDateTime(a.reported_at) }}</span>
          </div>
        </div>
      </div>

      <!-- 下单面板 -->
      <div style="display:flex; flex-direction:column; gap:16px">
        <div class="card card-pad">
          <div class="card-title">担保购买</div>
          <div class="price-block" style="margin-bottom:12px">
            <span class="price-current" style="font-size:26px">{{ fmtPrice(detail.price) }}</span>
            <span class="muted small">货款由平台托管，交接完成后再结算给卖家</span>
          </div>

          <div v-if="detail.status === 'locked'" class="card card-pad" style="background:var(--warning-weak); border:none; margin-bottom:12px">
            <span class="small" style="color:#b45309">该商品正在其他交易中（已锁定），暂不可购买。</span>
          </div>
          <div v-else-if="detail.status !== 'on'" class="card card-pad" style="background:var(--danger-weak); border:none; margin-bottom:12px">
            <span class="small" style="color:var(--danger)">商品已下架，暂不可购买。</span>
          </div>

          <template v-if="buyable">
            <label class="check-row" :class="{ muted: !detail.support_compensation }" style="margin-bottom:8px">
              <input v-model="withComp" type="checkbox" :disabled="!detail.support_compensation" />
              <span>购买<b>找回包赔服务</b>
                <template v-if="fees">（{{ fmtPrice(fees.compensation_fee) }}/单，确认收货起 {{ fees.guarantee_days }} 天内被找回先行赔付）</template>
                <template v-else>（费用以下单返回为准）</template>
              </span>
            </label>
            <p v-if="!detail.support_compensation" class="form-hint" style="margin:-4px 0 8px 22px">该商品卖家未开启包赔，不可加购</p>

            <label class="check-row" style="margin-bottom:12px">
              <input v-model="withAppr" type="checkbox" />
              <span>加购<b>鉴号服务</b>
                <template v-if="fees">（{{ fmtPrice(fees.appraisal_fee) }}/单，专家 24h 内出具报告，结论不符可一键全额退款）</template>
                <template v-else>（费用以下单返回为准）</template>
              </span>
            </label>

            <div style="border-top:1px dashed var(--border); padding-top:10px; font-size:13px">
              <div class="row between" style="margin-bottom:6px"><span class="muted">商品价款</span><span>{{ fmtPrice(detail.price) }}</span></div>
              <div v-if="withComp && detail.support_compensation" class="row between" style="margin-bottom:6px">
                <span class="muted">找回包赔服务费</span><span>{{ fees ? fmtPrice(fees.compensation_fee) : '—' }}</span>
              </div>
              <div v-if="withAppr" class="row between" style="margin-bottom:6px">
                <span class="muted">鉴号服务费</span><span>{{ fees ? fmtPrice(fees.appraisal_fee) : '—' }}</span>
              </div>
              <div class="row between" style="font-weight:700; font-size:15px">
                <span>合计（实付以下单返回为准）</span><span style="color:var(--danger)">{{ fees ? fmtPrice(estTotal) : fmtPrice(detail.price) + ' + 服务费' }}</span>
              </div>
            </div>

            <button class="btn btn-primary btn-block mt16" :disabled="ordering" @click="submitOrder">
              {{ ordering ? '正在下单…' : '立即下单并担保支付' }}
            </button>
            <p class="form-hint" style="margin-top:10px">下单即锁定商品，请在 30 分钟内完成支付；买家须已完成实名认证。</p>
          </template>
        </div>

        <div class="card card-pad">
          <div class="card-title">平台交易保障</div>
          <div class="muted small" style="line-height:2">
            ① 卖家实名 + 账号归属凭证人工审核<br />
            ② 货款平台托管，交接六步全程留痕<br />
            ③ AI 估值透明定价，支持加购专家鉴号<br />
            ④ 可选找回包赔：保障期内被找回，平台先行赔付
          </div>
        </div>
      </div>
    </div>

    <!-- 收银台 -->
    <PayModal v-if="payOrder" :pay-order="payOrder" @close="onPayClose" @success="onPaySuccess" />
  </main>
</template>
