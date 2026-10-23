<script setup>
// 帮助中心：常见问题 + 维权与追回指引入口（派出所检索收敛于此，不占顶部导航）
import { ref } from 'vue';

const open = ref('');
function toggle(key) {
  open.value = open.value === key ? '' : key;
}

const FAQS = [
  {
    key: 'buy',
    q: '如何在安全交易市场购买账号？',
    a: '在「安全交易」页挑选平台审核通过的商品，下单后货款进入平台托管，双方按「交接六步」完成账号转移并确认收货后，货款才结算给卖家。任一环节异常可在订单页申请客服介入。',
  },
  {
    key: 'sell',
    q: '如何上架出售自己的账号？',
    a: '在「卖家中心」完成实名认证与账号归属凭证审核（卖家资质）后，即可按游戏模板填写资产信息、上传截图并定价上架；平台审核通过后展示。货款结算与提现同样在卖家中心办理。',
  },
  {
    key: 'comp',
    q: '什么是找回包赔？',
    a: '勾选「支持找回包赔」的商品，完成交接后一定期限内若账号被卖家找回，可申请平台先行赔付；具体以商品详情页展示的服务说明与订单约定为准。',
  },
  {
    key: 'rights',
    q: '账号被找回后如何维权？',
    a: '在「我的订单 → 订单详情」点击「账号被找回？发起追账号维权」提交申报；平台核验成立后可一键生成民事起诉状与报案材料包，并出具交易存证证明协助您向法院起诉或向公安机关报案。已发起的维权案可在「追账号维权」中跟踪进展。',
  },
  {
    key: 'police',
    q: '想向公安机关报案，该去哪个派出所？',
    a: '使用「派出所检索 · 追回指引」按省市区或地图位置查找派出所地址与联系方式，网络案件一般可向犯罪行为发生地或结果发生地（通常为您所在地）公安机关报案。紧急情况请直接拨打 110；涉嫌电信网络诈骗可拨打反诈专线 96110 或使用国家反诈中心 App。报案不收取任何费用。',
  },
  {
    key: 'safe',
    q: '交易安全注意事项',
    a: '请勿相信任何站外联系方式或私下交易话术（平台会拦截并驳回相关描述）；账号交易须遵守各游戏用户协议，禁止外挂账号与未成年人交易。',
  },
];
</script>

<template>
  <main class="container page">
    <div class="page-title">帮助中心</div>
    <div class="page-sub">交易流程、维权与追回指引常见问题</div>

    <div class="card" style="padding: 8px 0">
      <div v-for="f in FAQS" :key="f.key" style="border-bottom: 1px solid var(--border)">
        <button
          class="faq-q"
          :class="{ open: open === f.key }"
          @click="toggle(f.key)"
        >
          <span>{{ f.q }}</span>
          <span class="faq-arrow">{{ open === f.key ? '−' : '+' }}</span>
        </button>
        <div v-if="open === f.key" class="faq-a">
          {{ f.a }}
          <div v-if="f.key === 'police'" style="margin-top: 10px">
            <RouterLink class="btn btn-sm" to="/police">进入派出所检索</RouterLink>
          </div>
          <div v-if="f.key === 'rights'" style="margin-top: 10px">
            <RouterLink class="btn btn-sm" to="/rights">查看我的维权案</RouterLink>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.faq-q {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: none;
  border: none;
  padding: 14px 20px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.faq-q:hover { background: var(--bg); }
.faq-arrow { font-size: 18px; color: var(--text2); }
.faq-a {
  padding: 0 20px 16px;
  font-size: 14px;
  color: var(--text2);
  line-height: 1.8;
}
</style>
