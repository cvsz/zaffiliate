#requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap the ZEAZ Affiliate Autopilot Windows development environment.
.EXAMPLE
  pwsh -NoProfile -File .\scripts\bootstrap-windows.ps1 -InstallPrerequisites
.EXAMPLE
  pwsh -NoProfile -File .\scripts\bootstrap-windows.ps1 -BuildDesktop
#>
[CmdletBinding()]
param(
    [switch]$InstallPrerequisites,
    [switch]$BuildDesktop,
    [switch]$SkipTests,
    [switch]$SkipDesktopInstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = Join-Path $root 'apps\desktop'

function Write-Step([string]$message) { Write-Host "[bootstrap] $message" -ForegroundColor Cyan }
function Require-Command([string]$name, [string]$hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name not found. $hint"
    }
}
function Invoke-Checked([string]$file, [string[]]$arguments) {
    & $file @arguments
    if ($LASTEXITCODE -ne 0) { throw "$file $($arguments -join ' ') failed with exit code $LASTEXITCODE" }
}
function Install-WithWinget([string]$id) {
    Require-Command 'winget' 'Install App Installer from Microsoft Store or install dependencies manually.'
    Write-Step "Installing $id via winget"
    Invoke-Checked 'winget' @('install','--id',$id,'--exact','--accept-source-agreements','--accept-package-agreements')
}
Push-Location $root
try {
    if ($env:OS -ne 'Windows_NT') { throw 'This bootstrap requires Windows.' }
    Write-Step "Repository: $root"
    if ($InstallPrerequisites) {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Install-WithWinget 'OpenJS.NodeJS.LTS' }
        if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) { Install-WithWinget 'Rustlang.Rustup' }
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-WithWinget 'Git.Git' }
        if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
            Write-Warning 'MSVC compiler not on PATH. Install Visual Studio 2022 Build Tools with Desktop development with C++ workload and Windows SDK. Then reopen PowerShell.'
        }
        Write-Step 'Check that Microsoft Edge WebView2 Runtime is installed (Windows 11 normally includes it).'
    }
    Require-Command 'node' 'Install Node.js 22+ and reopen PowerShell.'
    Require-Command 'npm' 'Install npm with Node.js.'
    Require-Command 'cargo' 'Install Rust MSVC toolchain with rustup and reopen PowerShell.'
    Require-Command 'rustc' 'Install Rust MSVC toolchain with rustup and reopen PowerShell.'
    $nodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]').Trim())
    if ($nodeMajor -lt 22) { throw "Node.js 22+ required; found $nodeMajor." }
    $rustHost = (& rustc -vV | Select-String '^host:\s*(.+)$').Matches.Groups[1].Value
    if ($rustHost -notmatch 'windows-msvc') { throw "Rust windows-msvc toolchain required; found $rustHost. Run rustup default stable-x86_64-pc-windows-msvc." }
    Write-Step "Node: $(& node --version); Rust: $(& rustc --version)"
    if (-not (Test-Path (Join-Path $root 'package-lock.json'))) { throw 'Missing root package-lock.json; refusing nondeterministic dependency install.' }
    Write-Step 'Installing root dependencies with npm ci'
    Invoke-Checked 'npm' @('ci','--ignore-scripts','--no-audit','--no-fund')
    Write-Step 'Checking JavaScript syntax'
    Invoke-Checked 'npm' @('run','check')
    if (-not $SkipTests) {
        Write-Step 'Running Node test suite'
        Invoke-Checked 'npm' @('test')
    }
    Write-Step 'Building existing React/Vite control plane'
    Invoke-Checked 'npm' @('run','build:web')
    if (-not $SkipDesktopInstall) {
        Push-Location $desktop
        try {
            $lock = Join-Path $desktop 'package-lock.json'
            if (Test-Path $lock) {
                Write-Step 'Installing locked desktop dependencies'
                Invoke-Checked 'npm' @('ci','--ignore-scripts','--no-audit','--no-fund')
            } else {
                Write-Warning 'Desktop package-lock.json not yet committed; using npm install --package-lock-only first. Commit lockfile in a dedicated PR before release.'
                Invoke-Checked 'npm' @('install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund')
                Invoke-Checked 'npm' @('ci','--ignore-scripts','--no-audit','--no-fund')
            }
            if ($BuildDesktop) {
                Write-Step 'Building unsigned Windows NSIS installer candidate'
                Invoke-Checked 'npm' @('run','build')
            }
        } finally { Pop-Location }
    } elseif ($BuildDesktop) { throw '-BuildDesktop cannot be combined with -SkipDesktopInstall.' }
    Write-Step 'Bootstrap complete. To launch: cd apps/desktop; npm run dev'
    Write-Warning 'Desktop CSP, packaged API session/origin, code signing, CodeQL alert #2 and clean-host testing remain release blockers.'
} finally { Pop-Location }
