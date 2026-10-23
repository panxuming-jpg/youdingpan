# Full deploy package: code + runtime data snapshot (data-bundle)
# Usage (run from project root):
#   powershell -ExecutionPolicy Bypass -File deploy\pack-full.ps1
#
# Zip layout:
#   server/ web/ deploy/ *.md *.pdf   -> code; unzip-overwrite on server is safe
#   data-bundle/server/data/          -> app.db (consistent snapshot via VACUUM INTO) + crawler state json
#   data-bundle/server/uploads/       -> uploaded / generated images
#
# Data protection: deploy/setup.sh merges data-bundle with `cp -rn` (no-clobber):
# files that already exist on the server are NEVER overwritten; only missing
# ones are added. So deploying this package to a server that already has data
# keeps all remote data intact, while a fresh server gets the full snapshot.
$ErrorActionPreference = "Stop"
$root  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $env:TEMP "youdingpan_pack_full"
$zip   = Join-Path $root "youdingpan-full-deploy.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path "$stage\server","$stage\web","$stage\data-bundle\server\data","$stage\data-bundle\server\uploads" | Out-Null

# ---------- data: consistent db snapshot (works while the local server runs) ----------
node "$root\deploy\db-snapshot.mjs" "$root\server\data\app.db" "$stage\data-bundle\server\data\app.db"
if ($LASTEXITCODE -ne 0) { throw "db snapshot failed (exit $LASTEXITCODE)" }
# crawler state files (cookies / last run) - merged no-clobber on server
Get-ChildItem "$root\server\data" -File -Filter *.json | Copy-Item -Destination "$stage\data-bundle\server\data\"
# uploaded / generated images
if (Test-Path "$root\server\uploads") {
  robocopy "$root\server\uploads" "$stage\data-bundle\server\uploads" /E /NFL /NDL /NJH /NJS | Out-Null
}

# ---------- server code: source only + dependency manifests ----------
robocopy "$root\server\src" "$stage\server\src" /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item "$root\server\package.json","$root\server\package-lock.json" "$stage\server\"

# ---------- web: source + public + build config + prebuilt dist ----------
robocopy "$root\web\src" "$stage\web\src" /E /NFL /NDL /NJH /NJS | Out-Null
if (Test-Path "$root\web\public") {
  robocopy "$root\web\public" "$stage\web\public" /E /NFL /NDL /NJH /NJS | Out-Null
}
Copy-Item "$root\web\package.json","$root\web\package-lock.json","$root\web\vite.config.js","$root\web\index.html" "$stage\web\" -ErrorAction SilentlyContinue
if (-not (Test-Path "$root\web\dist\index.html")) {
  throw "web/dist not found; build it first: cd web; npm run build"
}
robocopy "$root\web\dist" "$stage\web\dist" /E /NFL /NDL /NJH /NJS | Out-Null

# ---------- deploy scripts ----------
Copy-Item "$root\deploy" "$stage\deploy" -Recurse

# ---------- docs (copy by extension; avoid Chinese filename literals in PS5.1) ----------
Get-ChildItem $root -File -Filter *.md  | Copy-Item -Destination "$stage\"
Get-ChildItem $root -File -Filter *.pdf | Copy-Item -Destination "$stage\"

# ---------- auction data json (targeted idempotent import, never touches goods tables) ----------
node "$root\deploy\export-auction-data.mjs" "$stage\deploy\auction-data.json"
if ($LASTEXITCODE -ne 0) { throw "auction data export failed (exit $LASTEXITCODE)" }

# ---------- zip (bsdtar writes forward-slash entries for Linux unzip) ----------
if (Test-Path $zip) { Remove-Item $zip -Force }
tar -a -cf $zip -C $stage .
if ($LASTEXITCODE -ne 0) { throw "tar packaging failed (exit $LASTEXITCODE)" }
Remove-Item $stage -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Full package done (code + data-bundle): $zip  ($sizeMB MB)" -ForegroundColor Green
Write-Host 'Deploy: upload zip to server, unzip into /opt/youdingpan, then: sudo bash deploy/setup.sh  (existing remote data is kept, never overwritten)'
