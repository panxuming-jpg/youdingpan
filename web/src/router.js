import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';

const routes = [
  { path: '/', redirect: '/market' },
  { path: '/login', name: 'login', component: () => import('./views/Login.vue'), meta: { title: '登录' } },
  { path: '/market', name: 'market', component: () => import('./views/Market.vue'), meta: { title: '商品市场' } },
  { path: '/goods/:id', name: 'goods', component: () => import('./views/GoodsDetail.vue'), meta: { title: '商品详情' } },
  { path: '/auctions', name: 'auctions', component: () => import('./views/Auctions.vue'), meta: { title: '游拍卖' } },
  { path: '/auctions/publish', name: 'auction-publish', component: () => import('./views/PublishAuction.vue'), meta: { title: '发布拍卖', auth: true } },
  { path: '/auctions/mine', name: 'auction-mine', component: () => import('./views/MyAuctions.vue'), meta: { title: '我的拍卖', auth: true } },
  { path: '/auctions/:id', name: 'auction-detail', component: () => import('./views/AuctionDetail.vue'), meta: { title: '拍卖详情' } },
  { path: '/self', name: 'self-market', component: () => import('./views/SelfMarket.vue'), meta: { title: '自营市场' } },
  { path: '/self/:id', name: 'self-listing', component: () => import('./views/ListingDetail.vue'), meta: { title: '自营商品' } },
  { path: '/seller', name: 'seller-hub', component: () => import('./views/SellerHub.vue'), meta: { title: '卖家中心', auth: true } },
  { path: '/orders', name: 'my-orders', component: () => import('./views/MyOrders.vue'), meta: { title: '我的订单', auth: true } },
  { path: '/orders/:id', name: 'order-detail', component: () => import('./views/OrderDetail.vue'), meta: { title: '订单详情', auth: true } },
  { path: '/expert', name: 'expert-work', component: () => import('./views/ExpertWork.vue'), meta: { title: '鉴号专家', auth: true } },
  { path: '/tasks', name: 'tasks', component: () => import('./views/Tasks.vue'), meta: { title: '监控任务', auth: true } },
  { path: '/messages', name: 'messages', component: () => import('./views/Messages.vue'), meta: { title: '消息中心', auth: true } },
  { path: '/profile', name: 'profile', component: () => import('./views/Profile.vue'), meta: { title: '个人中心', auth: true } },
  { path: '/wallet', name: 'wallet', component: () => import('./views/Wallet.vue'), meta: { title: '我的钱包', auth: true } },
  { path: '/admin', name: 'admin', component: () => import('./views/Admin.vue'), meta: { title: '管理后台', auth: true, admin: true } },
  { path: '/admin/self', name: 'admin-self', component: () => import('./views/AdminSelf.vue'), meta: { title: '自营交易管理', auth: true, admin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(to => {
  if (to.meta.auth && !store.token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.admin && !store.user?.is_admin) {
    return { path: '/' };
  }
});

router.afterEach(to => {
  document.title = to.meta.title ? `${to.meta.title} · 游盯盘` : '游盯盘';
});

export default router;
