# Code-only upgrade package (data-protected mode)
# Usage (run from project root):
#   powershell -ExecutionPolicy Bypass -File deploy\pack.ps1
#
# This package contains NO runtime data, so unzip will never overwrite
# remote crawled game data:
#   - server/data/ whole dir (app.db, app.db-shm, app.db-wal, cookies, last_run)
#   - server/uploads/ (auction uploaded images)
$ErrorActionPreference = "Stop"
$root  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $env:TEMP "youdingpan_pack"
$zip   = Join-Path $root "youdingpan-deploy.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path "$stage\server","$stage\web" | Out-Null

# ---------- server: source only + dependency manifests ----------
robocopy "$root\server\src" "$stage\server\src" /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item "$root\server\package.json","$root\server\package-lock.json" "$stage\server\"
# NOTE: server\data (crawled game database) is intentionally excluded,
# as are loose *.mjs scripts in the server root.

# ---------- auction uploaded images (newest set; names are unique) ----------
if (Test-Path "$root\server\uploads") {
  robocopy "$root\server\uploads" "$stage\server\uploads" /E /NFL /NDL /NJH /NJS | Out-Null
}

# ---------- web: source + public + build config (setup.sh rebuilds on server) ----------
robocopy "$root\web\src" "$stage\web\src" /E /NFL /NDL /NJH /NJS | Out-Null
if (Test-Path "$root\web\public") {
  robocopy "$root\web\public" "$stage\web\public" /E /NFL /NDL /NJH /NJS | Out-Null
}
Copy-Item "$root\web\package.json","$root\web\package-lock.json","$root\web\vite.config.js","$root\web\index.html" "$stage\web\" -ErrorAction SilentlyContinue
# node_modules is excluded.

# Prebuilt frontend (IMPORTANT): without dist the server must run npm build,
# and a failed/skipped build leaves the old UI running (e.g. missing modules).
# Shipping dist makes the new UI effective immediately after unzip + restart.
if (Test-Path "$root\web\dist") {
  robocopy "$root\web\dist" "$stage\web\dist" /E /NFL /NDL /NJH /NJS | Out-Null
} else {
  throw "web/dist not found; build it first: cd web; npm run build"
}

# ---------- deploy scripts ----------
Copy-Item "$root\deploy" "$stage\deploy" -Recurse

# ---------- export auction data (auctions/bids/orders + related users/wallets) ----------
# This is a separate data file: on the server it is imported ONLY into the
# auction tables. The remote crawled game database is never overwritten.
node "$root\deploy\export-auction-data.mjs" "$stage\deploy\auction-data.json"
if ($LASTEXITCODE -ne 0) { throw "auction data export failed (exit $LASTEXITCODE)" }

if (Test-Path $zip) { Remove-Item $zip -Force }
# bsdtar writes zip entries with forward slashes so Linux unzip restores
# directories correctly (Compress-Archive on PS5 uses backslashes).
tar -a -cf $zip -C $stage .
if ($LASTEXITCODE -ne 0) { throw "tar packaging failed (exit $LASTEXITCODE)" }
Remove-Item $stage -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Package done (code only, no data): $zip  ($sizeMB MB)" -ForegroundColor Green
