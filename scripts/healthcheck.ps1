# Requires PowerShell 7+ (pwsh).

$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$port = if ($env:PORT) { $env:PORT } else { '8080' }
$base = "http://127.0.0.1:$port"
$liveness = 0

try {
  $null = Invoke-RestMethod -Uri "$base/healthz" -TimeoutSec 3
  Write-Host "healthcheck: liveness OK ($base/healthz)"
} catch {
  Write-Host "healthcheck: liveness FAILED — is the API running? (docker compose up -d)" -ForegroundColor Red
  $liveness = 1
}

try {
  $ready = Invoke-WebRequest -Uri "$base/readyz" -TimeoutSec 3 -SkipHttpErrorCheck
  switch ([int]$ready.StatusCode) {
    200 { Write-Host 'healthcheck: readiness OK' }
    503 { Write-Host 'healthcheck: readiness DEGRADED (missing dependencies; see /readyz body)' }
    default { Write-Host 'healthcheck: readiness UNREACHABLE' }
  }
} catch {
  Write-Host 'healthcheck: readiness UNREACHABLE'
}

try {
  $version = Invoke-RestMethod -Uri "$base/api/v1/version" -TimeoutSec 3
  Write-Host ("healthcheck: version {0} v{1}" -f $version.service, $version.version)
} catch {}

exit $liveness
