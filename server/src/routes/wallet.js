/**
 * 钱包路由：余额查询 / 收支明细 / 余额提现 / 提现记录
 * 提现流程：用户申请（扣减余额，生成 pending 单）→ 后台审核打款（paid）/ 驳回（退回余额）
 */
import { Router } from 'express';
import { db, getSettingNum, fundLog } from '../db.js';
import { authRequired } from '../middleware.js';
import { getWallet } from '../engine/auction.js';

const r = Router();

function shapeWithdraw(w) {
  return {
    id: w.id,
    amount: w.amount,
    fee: w.fee,
    channel: w.channel,
    account: w.account,
    status: w.status,
    remark: w.remark || '',
    created_at: w.created_at,
    processed_at: w.processed_at,
  };
}

// 钱包余额（balance 可用 / frozen 冻结中：出价保证金等）
r.get('/wallet', authRequired, (req, res) => {
  const w = getWallet(req.user.id);
  res.json({
    ok: true,
    data: {
      balance: w.balance,
      frozen: w.frozen,
      withdraw_min: getSettingNum('withdraw_min', 0),
      withdraw_fee_rate: getSettingNum('withdraw_fee_rate', 0),
      withdraw_free_threshold: getSettingNum('withdraw_free_threshold', 0),
    },
  });
});

// 收支明细（本人资金流水）
r.get('/wallet/logs', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM fund_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({
    ok: true,
    data: rows.map(l => ({
      id: l.id,
      biz: l.biz,
      amount: l.amount,
      direction: l.direction,
      ref_no: l.ref_no,
      channel: l.channel,
      remark: l.remark,
      created_at: l.created_at,
    })),
  });
});

// 申请提现
r.post('/wallet/withdraw', authRequired, (req, res) => {
  const amount = Number(req.body?.amount);
  const channel = String(req.body?.channel || '');
  const account = String(req.body?.account || '').trim().slice(0, 60);
  if (!Number.isFinite(amount) || amount <= 0) return res.json({ ok: false, error: '提现金额无效' });
  if (!['wechat', 'alipay'].includes(channel)) return res.json({ ok: false, error: '请选择提现渠道（微信/支付宝）' });
  if (!account) return res.json({ ok: false, error: '请填写收款账户' });

  const min = getSettingNum('withdraw_min', 0);
  if (amount < min) return res.json({ ok: false, error: `单笔最低提现金额 ¥${min.toFixed(2)}` });

  const w = getWallet(req.user.id);
  if (w.balance < amount) return res.json({ ok: false, error: '可用余额不足' });

  // 手续费：rate 计费；达到免手续费门槛则免收
  const rate = getSettingNum('withdraw_fee_rate', 0);
  const freeThreshold = getSettingNum('withdraw_free_threshold', 0);
  const fee = freeThreshold > 0 && amount >= freeThreshold ? 0 : Math.round(amount * rate * 100) / 100;

  const now = Date.now();
  db.prepare('UPDATE wallets SET balance=balance-? WHERE user_id=?').run(amount, req.user.id);
  const ins = db.prepare(`INSERT INTO withdraw_orders (user_id, amount, fee, channel, account, status, created_at) VALUES (?,?,?,?,?,'pending',?)`)
    .run(req.user.id, amount, fee, channel, account, now);
  fundLog({ userId: req.user.id, biz: 'withdraw', amount, direction: 'out', refNo: `W${ins.lastInsertRowid}`, channel, remark: `余额提现申请（手续费 ¥${fee.toFixed(2)}），待平台审核` });
  res.json({ ok: true, data: shapeWithdraw(db.prepare('SELECT * FROM withdraw_orders WHERE id=?').get(ins.lastInsertRowid)) });
});

// 提现记录
r.get('/wallet/withdraws', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM withdraw_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ ok: true, data: rows.map(shapeWithdraw) });
});

export default r;
