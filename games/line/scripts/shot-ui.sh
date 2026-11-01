#!/usr/bin/env bash
# 逐屏截取 live-gallery 的真实 canvas 渲染结果（含颗粒层）。
#
# 前提：dev server 已起在 5174（npm run dev -- --port 5174）。
#
# 用法：
#   scripts/shot-ui.sh              # 截全部 7 屏
#   scripts/shot-ui.sh home result  # 只截指定屏
set -u

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
PORT="${PORT:-5174}"
ROOT="I:/work/f-game/games/line"
OUT_WIN="I:\\work\\f-game\\games\\line\\out\\shots"
OUT_POS="$(cd "$(dirname "$0")/.." && pwd)/out/shots"

mkdir -p "$OUT_POS"

PAGES=("$@")
if [ ${#PAGES[@]} -eq 0 ]; then
  PAGES=(home map rank profile skins game result)
fi

for p in "${PAGES[@]}"; do
  # Windows 上 headless 截图路径必须是绝对路径且反斜杠，否则 0x5 拒绝访问
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --screenshot="$OUT_WIN\\cur-$p.png" --window-size=750,1334 --virtual-time-budget=6000 \
    "http://127.0.0.1:$PORT/tools/live-gallery.html?p=$p" >/dev/null 2>&1
  if [ -f "$OUT_POS/cur-$p.png" ]; then
    echo "  ok   cur-$p.png"
  else
    echo "  FAIL cur-$p.png"
  fi
done

echo "输出目录：$OUT_POS"
