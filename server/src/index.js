import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { verifyToken } from './util.js';
import { addClient } from './engine/sse.js';
import { startEngine } from './engine/engine.js';
import { startAuctionEngine } from './engine/auction.js';
import { startSelfTradeEngine } from './engine/selftrade.js';
import { backfillSimulatedChats } from './engine/ai_service.js';
import { backfillPendingContracts, backfillMissingContracts } from './engine/contract.js';
import authRoutes from './routes/auth.js';
import sellerRoutes from './routes/seller.js';
import orderRoutes from './routes/orders.js';
import appraiseRoutes from './routes/appraise.js';
import compRoutes from './routes/compensation.js';
import aichatRoutes from './routes/aichat.js';
import gameRoutes from './routes/games.js';
import goodsRoutes from './routes/goods.js';
import taskRoutes from './routes/tasks.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import auctionRoutes from './routes/auctions.js';
import payRoutes from './routes/pay.js';
import memberRoutes from './routes/member.js';
import walletRoutes from './routes/wallet.js';
import uploadRoutes, { uploadDir } from './routes/upload.js';
import rightsRoutes from './routes/rights.js';
import policeRoutes from './routes/police.js';

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
app.use('/api', payRoutes);
app.use('/api', memberRoutes);
app.use('/api', walletRoutes);
app.use('/api', uploadRoutes);
app.use('/api', sellerRoutes);
app.use('/api', orderRoutes);
app.use('/api', appraiseRoutes);
app.use('/api', compRoutes);
app.use('/api', aichatRoutes);
app.use('/api', rightsRoutes);
app.use('/api', policeRoutes);

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
  startSelfTradeEngine();
  // 演示补跑：watch 重启丢失 setTimeout 链后，对交接中且无模拟群聊记录的订单重新排期（幂等）
  setTimeout(() => backfillSimulatedChats(), 6000);
  // 电子合同：存量已支付订单补建双方已签署合同 + 待卖家签署合同补签（均幂等）
  setTimeout(() => backfillMissingContracts(), 2000);
  setTimeout(() => backfillPendingContracts(), 3000);
});
