/**
 * 邮件发送模块（nodemailer + SMTP 环境变量配置）
 *
 * 服务器上通过 systemd Environment 或 .env 注入以下变量启用真实发信：
 *   SMTP_HOST  SMTP 服务器地址（如 smtp.qq.com / smtp.163.com / smtp.exmail.qq.com）
 *   SMTP_PORT  端口（465=SSL，587=STARTTLS，默认 465）
 *   SMTP_USER  SMTP 登录账号（通常即发件邮箱）
 *   SMTP_PASS  SMTP 授权码（QQ/163 等邮箱需在网页设置里单独开通，不是登录密码）
 *   SMTP_FROM  发件人地址（可选，默认取 SMTP_USER）
 *
 * 未配置时 mailEnabled=false，sendMail 仅记录日志不报错，不影响站内提醒主流程。
 */
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST || '';
const port = Number(process.env.SMTP_PORT || 465);
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.SMTP_FROM || user;

let transporter = null;
if (host && user && pass) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465=SSL 直连；587/25 走 STARTTLS 协商
    auth: { user, pass },
    connectionTimeout: 10_000,
  });
  console.log(`[mail] SMTP 已配置：${host}:${port}，发件人 ${from}`);
} else {
  console.log('[mail] 未配置 SMTP_HOST/SMTP_USER/SMTP_PASS，邮件渠道降级为仅日志');
}

export const mailEnabled = !!transporter;

/**
 * 发送提醒邮件；失败只记日志不抛出（邮件是辅助渠道，不能影响入库与站内推送）
 * @returns {Promise<boolean>} 是否实际发出
 */
export async function sendMail(to, subject, text) {
  if (!transporter || !to) {
    if (!transporter) console.log(`[mail] 未启用，跳过发送 -> ${to || '(空)'}: ${subject}`);
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"游盯盘" <${from}>`,
      to,
      subject: `游盯盘 · ${subject}`,
      text,
    });
    console.log(`[mail] 已发送 -> ${to}: ${subject}`);
    return true;
  } catch (e) {
    console.error(`[mail] 发送失败 -> ${to}:`, e.message);
    return false;
  }
}
