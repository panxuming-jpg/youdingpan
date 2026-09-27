import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRequired } from '../middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// upload.js 位于 src/routes/，需 ../.. 回到 server 根目录
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 单文件 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|gif|webp|bmp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 jpg/png/gif/webp/bmp 图片'));
  },
});

const r = Router();

// 单图上传
r.post('/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: '请选择图片' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, data: { url, name: req.file.originalname, size: req.file.size } });
});

// multer 错误处理（文件过大 / 类型不符）
r.use((err, _req, res, _next) => {
  if (err) return res.json({ ok: false, error: err.message || '上传失败' });
  res.status(500).json({ ok: false, error: '上传失败' });
});

export { uploadDir };
export default r;
