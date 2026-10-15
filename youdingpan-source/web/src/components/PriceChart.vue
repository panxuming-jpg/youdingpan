<script setup>
import { computed } from 'vue';
import { fmtPrice, fmtDate } from '../utils.js';

const props = defineProps({
  points: { type: Array, default: () => [] }, // [{ price, recorded_at }]
});

const W = 660;
const H = 240;
const PL = 56;
const PR = 14;
const PT = 14;
const PB = 30;
const iw = W - PL - PR;
const ih = H - PT - PB;

const pts = computed(() => {
  const list = (props.points || []).filter(p => Number.isFinite(Number(p.price)));
  if (list.length === 0) return [];
  const ts = list.map(p => Number(p.recorded_at) || 0);
  const prices = list.map(p => Number(p.price));
  let tmin = Math.min(...ts);
  let tmax = Math.max(...ts);
  if (tmin === tmax) { tmin -= 1; tmax += 1; }
  let pmin = Math.min(...prices);
  let pmax = Math.max(...prices);
  const pad = (pmax - pmin) * 0.12 || Math.max(pmax * 0.06, 1);
  pmin = Math.max(0, pmin - pad);
  pmax = pmax + pad;
  return list.map((p, i) => ({
    x: PL + ((ts[i] - tmin) / (tmax - tmin)) * iw,
    y: PT + (1 - (prices[i] - pmin) / (pmax - pmin)) * ih,
    price: prices[i],
    ts: ts[i],
  }));
});

const linePath = computed(() =>
  pts.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
);

const areaPath = computed(() => {
  if (pts.value.length < 2) return '';
  const first = pts.value[0];
  const last = pts.value[pts.value.length - 1];
  return `${linePath.value} L${last.x.toFixed(1)} ${(PT + ih).toFixed(1)} L${first.x.toFixed(1)} ${(PT + ih).toFixed(1)} Z`;
});

const yTicks = computed(() => {
  if (pts.value.length === 0) return [];
  const n = 4;
  const prices = pts.value.map(p => p.price);
  let pmin = Math.min(...prices);
  let pmax = Math.max(...prices);
  const pad = (pmax - pmin) * 0.12 || Math.max(pmax * 0.06, 1);
  pmin = Math.max(0, pmin - pad);
  pmax = pmax + pad;
  const arr = [];
  for (let i = 0; i <= n; i++) {
    const v = pmin + ((pmax - pmin) * i) / n;
    arr.push({ y: PT + (1 - i / n) * ih, label: fmtPrice(v) });
  }
  return arr;
});

const xTicks = computed(() => {
  if (pts.value.length === 0) return [];
  const arr = [];
  const n = pts.value.length;
  const idx = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
  for (const i of [...new Set(idx)]) {
    arr.push({ x: pts.value[i].x, label: fmtDate(pts.value[i].ts) });
  }
  return arr;
});
</script>

<template>
  <div class="chart-box">
    <div v-if="pts.length < 2" class="empty" style="padding:30px 0">
      <div class="empty-text">暂无足够的价格数据，数据同步后将自动生成走势</div>
    </div>
    <svg v-else :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="价格走势图">
      <defs>
        <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#4f46e5" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <g v-for="(t, i) in yTicks" :key="`y${i}`">
        <line :x1="PL" :y1="t.y" :x2="W - PR" :y2="t.y" stroke="#eef0f6" stroke-width="1" />
        <text :x="PL - 8" :y="t.y + 4" text-anchor="end" font-size="11" fill="#9aa1af">{{ t.label }}</text>
      </g>
      <path v-if="areaPath" :d="areaPath" fill="url(#price-area)" />
      <path :d="linePath" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <g v-for="(t, i) in xTicks" :key="`x${i}`">
        <text :x="t.x" :y="H - 8" text-anchor="middle" font-size="11" fill="#9aa1af">{{ t.label }}</text>
      </g>
      <circle
        v-for="(p, i) in pts"
        :key="`p${i}`"
        :cx="p.x"
        :cy="p.y"
        :r="pts.length > 40 ? 2 : 3"
        fill="#fff"
        stroke="#4f46e5"
        stroke-width="1.6"
      >
        <title>{{ `${fmtDate(p.ts)}：${fmtPrice(p.price)}` }}</title>
      </circle>
    </svg>
  </div>
</template>
