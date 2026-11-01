$src = Join-Path $PSScriptRoot "..\data"
$dst = Join-Path $PSScriptRoot "..\..\server\data"
Copy-Item "$src\levels.json" "$dst\levels.json" -Force
Copy-Item "$src\solutions.json" "$dst\solutions.json" -Force
Copy-Item "$src\levels.json" "$dst\..\internal\games\line\levels.json" -Force
Copy-Item "$src\solutions.json" "$dst\..\internal\games\line\solutions.json" -Force
Write-Host "synced levels.json and solutions.json to server/data and server/internal/games/line"
