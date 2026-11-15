$ErrorActionPreference = "Stop"

# 脚本在 `games/line/scripts/` 下，仓库根在 `../../..`。
#
# ## 路径修正记录
#
# 原脚本写的是 `$PSScriptRoot\..\..\server\...` ——
# 从 `games/line/scripts/` 往上两级是 `games/`，于是目标变成了
# `games/server/...`（不存在）→ **同步一直是静默失败**的
# （`Copy-Item` 报错但脚本继续往下跑，最后还打印「synced」）。
#
# 正确路径：往上**三级**才是仓库根。
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$src = Join-Path $repoRoot "games\line\data"
$serverData = Join-Path $repoRoot "server\data"
$serverPkg = Join-Path $repoRoot "server\internal\games\line"

# ── 经典模式 ──
Copy-Item (Join-Path $src "levels.json") (Join-Path $serverData "levels.json") -Force
Copy-Item (Join-Path $src "solutions.json") (Join-Path $serverData "solutions.json") -Force
Copy-Item (Join-Path $src "levels.json") (Join-Path $serverPkg "levels.json") -Force
Copy-Item (Join-Path $src "solutions.json") (Join-Path $serverPkg "solutions.json") -Force

# ── Cover 模式 v3 ──
#
# **服务端那份含参考解**（成绩校验用），必须同步 ——
# 服务端优先读磁盘、失败才回退到 `//go:embed` 的内嵌副本，
# 所以不同步的话，开发期读磁盘是新的、编译后跑内嵌的还是旧的。
Copy-Item (Join-Path $src "levels-v3.json") (Join-Path $serverData "levels-v3.json") -Force
Copy-Item (Join-Path $src "levels-v3.json") (Join-Path $serverPkg "levels-v3.json") -Force

# 客户端那份不含解 —— 打包进前端，由 vite 从 `games/line/data/` 直接读，
# 不需要同步到服务端。

Write-Host "synced levels.json / solutions.json / levels-v3.json to server/data and server/internal/games/line"
