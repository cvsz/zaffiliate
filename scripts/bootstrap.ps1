# Requires PowerShell 7+ (pwsh). Errors are actionable and non-destructive.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Fail($message) { Write-Error "bootstrap: $message" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node is required (>=22): https://nodejs.org' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'docker is required: https://docs.docker.com/engine/install/' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'docker compose plugin is required' }

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'bootstrap: created .env from .env.example'
}

function New-LocalSecret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Ensure-EnvValue([string]$key, [string]$value) {
  $content = Get-Content '.env' -Raw
  if ($content -match ("(?m)^" + $key + "=.+$")) { return }
  if ($content -match ("(?m)^" + $key + "=$")) {
    Set-Content -Path '.env' -Value ($content -replace ("(?m)^" + $key + "=$"), ($key + '=' + $value)) -NoNewline
  } else {
    Add-Content -Path '.env' -Value ($key + '=' + $value)
  }
  Write-Host ("bootstrap: generated local {0}" -f $key)
}

Ensure-EnvValue 'SESSION_SECRET' (New-LocalSecret)
Ensure-EnvValue 'ENCRYPTION_KEY' (New-LocalSecret)
Ensure-EnvValue 'VISITOR_SALT' (New-LocalSecret)

New-Item -ItemType Directory -Force -Path 'dist', 'logs' | Out-Null

Write-Host 'bootstrap: starting dependency services (postgres, redis)'
docker compose up -d postgres redis
if ($LASTEXITCODE -ne 0) { Fail 'docker compose failed to start dependencies' }

Write-Host 'bootstrap: waiting for postgres readiness'
$ready = $false
foreach ($i in 1..30) {
  docker compose exec -T postgres pg_isready -U zaffiliate -d zaffiliate *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Fail 'postgres did not become healthy' }

Write-Host 'bootstrap: running migrations'
& './scripts/migrate.sh'

Write-Host 'bootstrap: done. Start the full stack with: docker compose up -d'
