# YouDingPan public tunnel watchdog (localhost.run)
# - Auto reconnect on disconnect; probes public health every 20s,
#   kills dead/stale ssh (503) and rebuilds the tunnel immediately.
# - If ~/.ssh/id_ed25519 is bound to a paid localhost.run custom domain,
#   pass the stable domain via -Domain (e.g. xxxxx.lhr.rocks).
# Usage: powershell -ExecutionPolicy Bypass -File tunnel.ps1 [-Domain yourname.lhr.rocks]

param(
  [string]$Domain = ""
)

$ErrorActionPreference = "Continue"
$keyPath = "$env:USERPROFILE\.ssh\id_ed25519"

function New-Tunnel {
  $logFile = [System.IO.Path]::GetTempFileName()
  $sshArgs = @(
    "-o","StrictHostKeyChecking=no",
    "-o","ServerAliveInterval=15",
    "-o","ServerAliveCountMax=2",
    "-o","TCPKeepAlive=yes",
    "-o","ExitOnForwardFailure=yes"
  )
  if (Test-Path $keyPath) { $sshArgs += @("-i", $keyPath, "-o", "IdentitiesOnly=yes") }

  if ($Domain) {
    # Stable custom domain (paid plan): ssh -R domain:80:localhost:3000 plan@localhost.run
    $sshArgs += @("-R", "${Domain}:80:localhost:3000", "plan@localhost.run")
  } else {
    $sshArgs += @("-R", "80:localhost:3000", "nokey@localhost.run")
  }

  $p = Start-Process -FilePath "ssh" -ArgumentList $sshArgs -PassThru -NoNewWindow `
        -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"
  return @{ Proc = $p; Log = $logFile; ErrLog = "$logFile.err"; PubDomain = $Domain }
}

Write-Host "==> Tunnel watchdog started (health probe every 20s)" -ForegroundColor Cyan
if ($Domain) { Write-Host "==> Stable domain: https://$Domain" -ForegroundColor Green }

$t = New-Tunnel
$failStreak = 0

while ($true) {
  Start-Sleep -Seconds 20

  if (-not $t.PubDomain) {
    $lines = @()
    foreach ($f in @($t.Log, $t.ErrLog)) {
      if (Test-Path $f) { $lines += Get-Content $f -ErrorAction SilentlyContinue }
    }
    $m = $lines | Select-String -Pattern '([a-z0-9]+\.lhr\.life) tunneled' | Select-Object -First 1
    if ($m) {
      $t.PubDomain = $m.Matches[0].Groups[1].Value
      Write-Host ""
      Write-Host "============================================================" -ForegroundColor Green
      Write-Host ("  PUBLIC URL: https://" + $t.PubDomain) -ForegroundColor Green
      Write-Host "============================================================" -ForegroundColor Green
      Write-Host ""
    }
  }

  $alive = -not $t.Proc.HasExited
  $healthy = $false
  if ($t.PubDomain) {
    try {
      $r = Invoke-WebRequest "https://$($t.PubDomain)/api/health" -UseBasicParsing -TimeoutSec 10
      $healthy = ($r.StatusCode -eq 200)
    } catch { $healthy = $false }
  }

  if ($alive -and ($healthy -or -not $t.PubDomain)) {
    $failStreak = 0
    continue
  }

  $failStreak++
  $reason = if (-not $alive) { "ssh exited" } else { "public health check failed (503/stale)" }
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $reason (#$failStreak), reconnecting..." -ForegroundColor Yellow

  if (-not $t.Proc.HasExited) { Stop-Process -Id $t.Proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 5
  try { Remove-Item $t.Log,$t.ErrLog -ErrorAction SilentlyContinue } catch {}
  $t = New-Tunnel
  $failStreak = 0
}
