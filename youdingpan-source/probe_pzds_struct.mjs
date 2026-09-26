// 分析 nuxt_pzds.json 结构：找 goodsList 路径 + dump 第一条样例
import fs from 'node:fs';
const nu = JSON.parse(fs.readFileSync('nuxt_pzds.json', 'utf8'));

console.log('顶层键:', Object.keys(nu));
console.log('__NUXT__.data 是否数组:', Array.isArray(nu.data), 'len=', nu.data?.length);
if (Array.isArray(nu.data) && nu.data[0]) {
  console.log('data[0] 键:', Object.keys(nu.data[0]));
  const gl = nu.data[0].goodsList;
  if (Array.isArray(gl)) {
    console.log('goodsList 长度:', gl.length);
    console.log('第一条字段:', Object.keys(gl[0]).join(','));
    console.log('第一条样例:', JSON.stringify(gl[0], null, 2).slice(0, 1500));
  } else {
    console.log('data[0].goodsList 不是数组:', typeof gl);
  }
} else if (nu.data) {
  console.log('data 是对象:', typeof nu.data);
  console.log('data 键:', Object.keys(nu.data));
}
