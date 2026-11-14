# 启动本地开发环境（后端 50001 + 前端 50002）。
#
# 为什么需要这个脚本：
#   1. 本机 PATH 里没有 npm，只能直接调 Cursor 自带的 node；
#   2. 直接在终端里跑，终端一关进程就被回收 —— 表现为「刚才还好好的，
#      过一会儿后端就不通了」。这个脚本用 Start-Process 起**脱离会话**的进程。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1
#
# 停止：
#   powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1 -Stop

param(
    [switch]$Stop,
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

# Windows 控制台默认按 ANSI 解码，脚本里的中文会显示成乱码。强制 UTF-8。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 向上找仓库根：那一层必须同时有 server/go.mod 和 games/line。
# 不写死层数，免得以后目录结构调整了脚本又悄悄找错位置（踩过一次：
# 之前假设根在 games/line 上一级，结果 go build 在错的目录跑，
# 报 "cannot find main module"）。
$RepoRoot = $PSScriptRoot
while ($RepoRoot -and -not (
    (Test-Path (Join-Path $RepoRoot 'server\go.mod')) -and
    (Test-Path (Join-Path $RepoRoot 'games\line'))
)) {
    $RepoRoot = Split-Path -Parent $RepoRoot
}
if (-not $RepoRoot) { throw '找不到仓库根目录（向上找不到 server/go.mod + games/line）' }

$LineDir    = Join-Path $RepoRoot 'games\line'
$ServerDir  = Join-Path $RepoRoot 'server'
$BinDir     = Join-Path $ServerDir 'deploy\bin'
$BackendLog = Join-Path $BinDir 'http.log.err'
$FrontendLog = Join-Path $LineDir 'vite.log.err'

$BackendPort  = 50001
$FrontendPort = 50002
$NodeExe = 'D:\Program Files\cursor\resources\app\resources\helpers\node.exe'

function Stop-ByPort([int]$Port, [string]$Label) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "[$Label] 停止占用 $Port 的进程 (PID $($c.OwningProcess))" -ForegroundColor Yellow
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

if ($Stop) {
    Stop-ByPort $FrontendPort '前端'
    Stop-ByPort $BackendPort  '后端'
    Write-Host '已停止。' -ForegroundColor Green
    exit 0
}

# ── 1. 依赖容器 ────────────────────────────────────────────────
# PostgreSQL / Redis 走已有容器（端口 15432 / 6379）。
# Docker Desktop 没开的话先把它拉起来，否则后端会因为连不上库直接退出。
if (-not (docker info --format '{{.ServerVersion}}' 2>$null)) {
    Write-Host 'Docker 未运行，尝试启动 Docker Desktop...' -ForegroundColor Yellow
    Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        if (docker info --format '{{.ServerVersion}}' 2>$null) { break }
    }
}

# ── 2. 后端 ───────────────────────────────────────────────────
Stop-ByPort $BackendPort '后端'

if ($Rebuild -or -not (Test-Path (Join-Path $BinDir 'http.exe'))) {
    Write-Host '编译后端...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    Push-Location $ServerDir
    try {
        $env:GOTOOLCHAIN = 'local'
        go build -o (Join-Path $BinDir 'http.exe') ./cmd/http
        if ($LASTEXITCODE -ne 0) { throw 'go build 失败' }
    } finally { Pop-Location }
}

Write-Host "启动后端 :$BackendPort ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Start-Process -FilePath (Join-Path $BinDir 'http.exe') `
    -ArgumentList '--config', 'deploy\config.local.yaml' `
    -WorkingDirectory $ServerDir `
    -RedirectStandardOutput (Join-Path $BinDir 'http.log') `
    -RedirectStandardError $BackendLog `
    -WindowStyle Hidden

# 等后端就绪
$ok = $false
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-RestMethod "http://127.0.0.1:$BackendPort/healthz" -TimeoutSec 2
        if ($r.ok) { $ok = $true; break }
    } catch { }
}
if (-not $ok) {
    Write-Host "后端启动失败，日志：" -ForegroundColor Red
    Get-Content $BackendLog -Tail 30 -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "后端就绪 http://127.0.0.1:$BackendPort" -ForegroundColor Green

# ── 3. 前端 ───────────────────────────────────────────────────
Stop-ByPort $FrontendPort '前端'
Write-Host "启动前端 :$FrontendPort ..." -ForegroundColor Cyan
Start-Process -FilePath $NodeExe `
    -ArgumentList 'node_modules\vite\bin\vite.js', '--host', '0.0.0.0', '--port', "$FrontendPort", '--strictPort' `
    -WorkingDirectory $LineDir `
    -RedirectStandardOutput (Join-Path $LineDir 'vite.log') `
    -RedirectStandardError $FrontendLog `
    -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$FrontendPort/" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { break }
    } catch { }
}

Write-Host ''
Write-Host '  前端  http://127.0.0.1:50002' -ForegroundColor Green
Write-Host '  后端  http://127.0.0.1:50001/healthz' -ForegroundColor Green
Write-Host '  停止  powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1 -Stop' -ForegroundColor DarkGray
