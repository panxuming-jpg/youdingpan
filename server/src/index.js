import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { verifyToken } from './util.js';
import { addClient } from './engine/sse.js';
import { startEngine } from './engine/engine.js';
import { startAuctionEngine } from './engine/auction.js';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/games.js';
import goodsRoutes from './routes/goods.js';
import taskRoutes from './routes/tasks.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import auctionRoutes from './routes/auctions.js';
import uploadRoutes, { uploadDir } from './routes/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api', gameRoutes);
app.use('/api', goodsRoutes);
app.use('/api', taskRoutes);
app.use('/api', messageRoutes);
app.use('/api', adminRoutes);
app.use('/api', auctionRoutes);
app.use('/api', uploadRoutes);

// 上传图片静态资源映射（server/uploads → /uploads/**）
app.use('/uploads', express.static(uploadDir));

// SSE 实时推送（token 通过 query 传递，EventSource 不支持自定义 Header）
app.get('/api/sse', (req, res) => {
  const uid = verifyToken(String(req.query.token || ''));
  if (!uid) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: {"ok":true}\n\n`);
  addClient(uid, res);
});

// 健康检查
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 生产模式：托管前端构建产物
const distDir = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// 统一错误处理
app.use((err, _req, res, _next) => {
  console.error('[server]', err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] 游盯盘服务已启动: http://localhost:${PORT}`);
  startEngine();
  startAuctionEngine();
});
