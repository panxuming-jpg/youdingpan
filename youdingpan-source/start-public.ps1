# 游盯盘 一键公网启动脚本（含隧道自动重连）
# 用法：右键 -> 使用 PowerShell 运行
# 作用：启动 Node 服务 + localhost.run 公网隧道，隧道断开自动重连

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir = "C:\Users\htuser\.local\lib\node-v22.23.2-win-x64"
$env:PATH = "$nodeDir;$env:PATH"

# 清理旧进程
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process ssh -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Write-Host "==> 启动游盯盘服务（端口 3000）..." -ForegroundColor Cyan
$server = Start-Process -FilePath "node" -ArgumentList "src/index.js" -WorkingDirectory "$root\server" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4

try {
    Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 5 | Out-Null
    Write-Host "    服务已就绪" -ForegroundColor Green
} catch {
    Write-Host "    服务启动失败，请检查端口 3000" -ForegroundColor Red
    exit 1
}

Write-Host "`n==> 启动 localhost.run 公网隧道（看门狗模式）..." -ForegroundColor Cyan
Write-Host "    公网地址会在下方绿色框中显示；断线/503 会在 20 秒内自动重连" -ForegroundColor Yellow
Write-Host ""

# 隧道看门狗：健康探测 + 自动重连（已绑定账号密钥则为固定域名）
& "$root\tunnel.ps1"
