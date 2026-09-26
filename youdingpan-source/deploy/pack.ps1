# 打包部署用代码包（排除 node_modules、临时探测文件、浏览器缓存）
# 用法：在项目根目录运行  powershell -ExecutionPolicy Bypass -File deploy\pack.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $env:TEMP "youdingpan_pack"
$zip   = Join-Path $root "youdingpan-deploy.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path "$stage\server","$stage\web" | Out-Null

# server：源码 + package.json + 已有数据库（可选，保留历史采集数据）
robocopy "$root\server\src" "$stage\server\src" /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item "$root\server\package.json" "$stage\server\"
if (Test-Path "$root\server\data\app.db") {
  New-Item -ItemType Directory -Path "$stage\server\data" | Out-Null
  Copy-Item "$root\server\data\app.db" "$stage\server\data\"   # 只带主库，不带 WAL/SHM
}
# web：源码（服务器上重新 build），不带 node_modules/dist
robocopy "$root\web\src" "$stage\web\src" /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item "$root\web\package.json","$root\web\vite.config.js","$root\web\index.html" "$stage\web\" -ErrorAction SilentlyContinue
# 部署脚本
Copy-Item "$root\deploy" "$stage\deploy" -Recurse

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Write-Host "打包完成: $zip" -ForegroundColor Green
Write-Host "上传到服务器后： sudo mkdir -p /opt/youdingpan; sudo unzip youdingpan-deploy.zip -d /opt/youdingpan; sudo bash /opt/youdingpan/deploy/setup.sh" -ForegroundColor Cyan
