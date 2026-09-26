#!/usr/bin/env bash
# =====================================================================
# 游盯盘 一键部署脚本（Ubuntu 22.04 / 24.04，Debian 12 也适用）
# 用法（在服务器上，代码放到 /opt/youdingpan 后）：
#   sudo bash /opt/youdingpan/deploy/setup.sh
# 作用：装 Node22 + Chrome(含全部运行库) + 中文字体、构建前端、
#       安装 systemd 常驻服务（开机自启/崩溃自重启）
# =====================================================================
set -e

APP_DIR="/opt/youdingpan"
APP_USER="root"

if [ "$(id -u)" != "0" ]; then echo "请用 root 运行：sudo bash setup.sh"; exit 1; fi
if [ ! -d "$APP_DIR/server" ] || [ ! -d "$APP_DIR/web" ]; then
  echo "未找到 $APP_DIR/server 或 $APP_DIR/web，请先把代码上传到 $APP_DIR"
  exit 1
fi

echo "==> [1/6] 系统依赖更新 + Chrome + 中文字体..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip fonts-noto-cjk fonts-noto-color-emoji
# Google Chrome 稳定版（自动带齐 Chromium 运行所需的全部共享库）
if ! command -v google-chrome >/dev/null 2>&1; then
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb || true
  apt-get install -y /tmp/chrome.deb || apt-get -f install -y
fi
google-chrome --version

echo "==> [2/6] 安装 Node.js 22..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v; npm -v

echo "==> [3/6] 安装后端依赖（puppeteer-core 不会额外下载浏览器，使用系统 Chrome）..."
cd "$APP_DIR/server"
npm install --omit=dev

echo "==> [4/6] 构建前端..."
cd "$APP_DIR/web"
npm install
npm run build

echo "==> [5/6] 数据目录 + 时区..."
mkdir -p "$APP_DIR/server/data"
timedatectl set-timezone Asia/Shanghai || true

echo "==> [6/6] 安装 systemd 服务..."
cat > /etc/systemd/system/youdingpan.service <<EOF
[Unit]
Description=YouDingPan game account monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=TZ=Asia/Shanghai
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5
# 浏览器采集需要较多内存，预留上限（按机器规格可调整）
MemoryHigh=1200M

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable youdingpan
systemctl restart youdingpan
sleep 3
systemctl --no-pager --lines=15 status youdingpan || true

echo ""
echo "============================================================"
echo " 部署完成！本机验证：curl http://localhost:3000/api/health"
echo "------------------------------------------------------------"
echo " 下一步（二选一）："
echo "  A. 直接用 IP+端口访问：云服务器安全组放行 3000 端口(TCP)"
echo "  B. 用域名+80/443(推荐)：安装 nginx 后见 deploy/nginx 说明"
echo "============================================================"
