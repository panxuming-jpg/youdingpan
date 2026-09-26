import { B7881Adapter } from './b7881.js';
import { PanzhiAdapter } from './panzhi.js';
import { JiaoyimaoAdapter } from './jiaoyimao.js';
import { PangxieAdapter } from './pangxie.js';

// 4 个真实平台适配器（全部 realMode=true，绝不造数）：
// - 交易猫：移动端拦 mtop...getunifiedgoodslist XHR
// - 盼之：取 window.__NUXT__.data[0].goodsList（SSR 内嵌 JSON）
// - 螃蟹：H5 预热 + 页面内 fetch selectSearchPageList（绕开 PC 端 FeiLin 滑块）
// - 7881：拦 goods-service-api/api/goods/list XHR
//
// 已下线的模拟兜底平台（藏宝阁/5173 仅网易系/端游，与目标 4 款腾讯头部游戏无关）。

// 只保留真实平台；模拟兜底平台已下线，避免任何模拟数据混入
export const ADAPTERS = [
  new JiaoyimaoAdapter(),
  new PanzhiAdapter(),
  new PangxieAdapter(),
  new B7881Adapter(),
];
