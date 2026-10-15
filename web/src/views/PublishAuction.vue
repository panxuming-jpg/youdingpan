<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, getToken } from '../api.js';
import { toast } from '../toast.js';

const router = useRouter();

const games = ref([]);
const loading = ref(false);
const uploading = ref(false);
const linkInput = ref('');
const form = ref({
  game_id: '',
  server_id: '',
  title: '',
  description: '',
  images: [],
  start_price: '',
  increment: '',
  reserve_price: '',
  duration: 24 * 3600,
});

const DURATIONS = [
  { value: 12 * 3600, label: '12 小时' },
  { value: 24 * 3600, label: '24 小时' },
  { value: 48 * 3600, label: '48 小时' },
  { value: 72 * 3600, label: '72 小时' },
];

const MAX_IMAGES = 6;

const servers = computed(() => {
  const g = games.value.find(x => x.id === Number(form.value.game_id));
  return g?.servers || [];
});

const deposit = computed(() => {
  const sp = Number(form.value.start_price);
  return Number.isFinite(sp) && sp > 0 ? Math.max(1, Math.round(sp * 0.1 * 100) / 100) : 0;
});

onMounted(async () => {
  try {
    games.value = await api('/games');
  } catch { /* 静默 */ }
});

// 本地上传：用原生 fetch + FormData（api.js 默认 JSON 不支持 multipart）
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

async function onFileChange(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const remain = MAX_IMAGES - form.value.images.length;
  if (remain <= 0) {
    toast.error(`最多上传 ${MAX_IMAGES} 张图片`);
    e.target.value = '';
    return;
  }
  const toUpload = files.slice(0, remain);
  uploading.value = true;
  let ok = 0;
  for (const f of toUpload) {
    if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} 超过 5MB`); continue; }
    try {
      const url = await uploadImage(f);
      form.value.images.push(url);
      ok++;
    } catch (err) {
      toast.error(`${f.name} 上传失败：${err.message}`);
    }
  }
  uploading.value = false;
  e.target.value = '';
  if (ok) toast.success(`已上传 ${ok} 张图片`);
}

function removeImage(idx) {
  form.value.images.splice(idx, 1);
}

function addLink() {
  const url = linkInput.value.trim();
  if (!url) return;
  if (form.value.images.length >= MAX_IMAGES) {
    toast.error(`最多 ${MAX_IMAGES} 张图片`);
    return;
  }
  form.value.images.push(url);
  linkInput.value = '';
}

async function submit() {
  const f = form.value;
  if (!f.game_id) return toast.error('请选择游戏');
  if (!f.title.trim()) return toast.error('请填写拍卖标题');
  const sp = Number(f.start_price);
  if (!Number.isFinite(sp) || sp < 0) return toast.error('起拍价必须大于等于 0');
  const inc = Number(f.increment);
  if (!Number.isFinite(inc) || inc <= 0) return toast.error('加价幅度必须大于 0');
  if (f.reserve_price !== '' && Number(f.reserve_price) <= sp) return toast.error('保留价必须大于起拍价');

  loading.value = true;
  try {
    const res = await api('/auctions', {
      method: 'POST',
      body: {
        game_id: Number(f.game_id),
        server_id: f.server_id ? Number(f.server_id) : null,
        title: f.title.trim(),
        description: f.description.trim(),
        images: f.images.slice(0, MAX_IMAGES),
        start_price: sp,
        increment: inc,
        reserve_price: f.reserve_price === '' ? null : Number(f.reserve_price),
        duration: f.duration,
      },
    });
    toast.success('发布成功，拍卖已开始！');
    router.push(`/auctions/${res.id}`);
  } catch (e) {
    toast.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="container page">
    <div class="page-title">发布拍卖</div>
    <div class="page-sub">填写账号信息与拍卖规则，发布后不可修改（可下架重发）</div>

    <div class="card card-pad" style="max-width:720px">
      <div class="form-row">
        <div class="form-item">
          <label class="form-label">游戏 <span class="req">*</span></label>
          <select v-model="form.game_id" class="select">
            <option value="">请选择游戏</option>
            <option v-for="g in games" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="form-label">区服</label>
          <select v-model="form.server_id" class="select" :disabled="!servers.length">
            <option value="">请选择区服（可选）</option>
            <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>

      <div class="form-item">
        <label class="form-label">拍卖标题 <span class="req">*</span></label>
        <input v-model="form.title" class="input" maxlength="80" placeholder="例：【V10全皮肤】荣耀典藏全齐 限定皮肤328款" />
      </div>

      <div class="form-item">
        <label class="form-label">账号描述</label>
        <textarea v-model="form.description" class="textarea" rows="5" placeholder="账号亮点、段位、皮肤、道具、充值记录、绑定情况等（建议详细填写，提升成交率）"></textarea>
      </div>

      <!-- 图片上传 -->
      <div class="form-item">
        <label class="form-label">账号图片（最多 {{ MAX_IMAGES }} 张，支持本地上传）</label>

        <!-- 预览网格 -->
        <div class="upload-grid">
          <div v-for="(img, idx) in form.images" :key="img" class="upload-item">
            <img :src="img" alt="预览" />
            <button class="upload-remove" @click="removeImage(idx)" aria-label="删除图片">×</button>
          </div>
          <label v-if="form.images.length < MAX_IMAGES" class="upload-add" :class="{ disabled: uploading }">
            <input type="file" accept="image/*" multiple hidden :disabled="uploading" @change="onFileChange" />
            <span v-if="uploading" class="spinner" style="margin:0"></span>
            <template v-else>
              <span class="upload-plus">+</span>
              <span class="upload-text">上传图片</span>
            </template>
          </label>
        </div>

        <div class="form-hint">支持 jpg / png / gif / webp / bmp，单张不超过 5MB</div>

        <!-- 手动添加链接（备选） -->
        <div class="row mt8" style="gap:8px">
          <input v-model="linkInput" class="input" placeholder="或粘贴图片链接" style="flex:1" @keyup.enter="addLink" />
          <button class="btn btn-ghost btn-sm" :disabled="!linkInput.trim()" @click="addLink">添加链接</button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-item">
          <label class="form-label">起拍价（元）<span class="req">*</span></label>
          <input v-model="form.start_price" type="number" min="0" step="0.01" class="input" placeholder="0" />
        </div>
        <div class="form-item">
          <label class="form-label">加价幅度（元）<span class="req">*</span></label>
          <input v-model="form.increment" type="number" min="1" step="1" class="input" placeholder="10" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-item">
          <label class="form-label">保留价（元，选填）</label>
          <input v-model="form.reserve_price" type="number" min="0" step="0.01" class="input" placeholder="留空表示无保留价" />
          <div class="form-hint">设置后，若最高出价未达保留价则流拍，不收取手续费</div>
        </div>
        <div class="form-item">
          <label class="form-label">拍卖时长 <span class="req">*</span></label>
          <select v-model="form.duration" class="select">
            <option v-for="d in DURATIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
      </div>

      <div class="card card-pad" style="background:var(--bg); margin-bottom:16px">
        <div class="row between" style="margin-bottom:6px">
          <span class="muted">竞拍保证金（起拍价 × 10%）</span>
          <b>{{ deposit > 0 ? `¥${deposit.toFixed(2)}` : '-' }}</b>
        </div>
        <div class="row between" style="margin-bottom:6px">
          <span class="muted">延时规则</span>
          <span class="small">结束前 5 分钟内有人出价，自动延时 5 分钟（最多 10 次）</span>
        </div>
        <div class="row between">
          <span class="muted">交易手续费</span>
          <span class="small">成交价的 5%（仅卖家支付，流拍免费）</span>
        </div>
      </div>

      <button class="btn btn-primary btn-lg btn-block" :disabled="loading" @click="submit">
        {{ loading ? '发布中…' : '确认发布' }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.upload-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
}
.upload-item {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--border);
}
.upload-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.upload-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.upload-remove:hover { background: var(--danger); }
.upload-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1.5px dashed var(--border-strong);
  border-radius: 8px;
  background: #fafbff;
  color: var(--text3);
  cursor: pointer;
  transition: all 0.15s;
  gap: 4px;
}
.upload-add:hover:not(.disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-weak);
}
.upload-add.disabled { opacity: 0.5; cursor: not-allowed; }
.upload-plus { font-size: 28px; line-height: 1; font-weight: 300; }
.upload-text { font-size: 12px; }
</style>
