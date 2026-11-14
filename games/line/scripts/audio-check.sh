#!/usr/bin/env bash
# 音色自检：在真 Chrome 里把五套音色离线渲染出来，读真实采样。
#
# 为什么不是「听一下」：WebAudio 的失败大多是**静默**的 ——
# 节点连错、混响没接上、增益被压成 0，页面不报错、控制台干净，只是没声。
# 而开发机上「是不是系统静音了」能把这个 bug 糊弄很久。
#
# 前提：dev server 已起（默认 50002）。
# 用法：scripts/audio-check.sh [voice...]
set -u

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
PORT="${PORT:-50002}"
VOICES=("$@")
if [ ${#VOICES[@]} -eq 0 ]; then
  VOICES=(clay glass orbit obsidian gilded mute)
fi

# 为什么要重试：headless Chrome 的 OfflineAudioContext 在节点较多时
# 会偶发地不 resolve `startRendering()`（同一份代码重跑就过）。
# 这不是引擎的问题，但会让 CI/脚本误报，所以最多试 6 次。
for v in "${VOICES[@]}"; do
  for i in 1 2 3 4 5 6; do
    out=$("$CHROME" --headless=new --disable-gpu --autoplay-policy=no-user-gesture-required \
      --virtual-time-budget=20000 --dump-dom \
      "http://127.0.0.1:$PORT/tools/audio-check.html?v=$v" 2>/dev/null \
      | grep -o '<pre id="out">[^<]*' | sed 's/<pre id="out">//')
    case "$out" in
      ok*|FAIL*) echo "  $out"; break ;;
      *) [ "$i" -eq 6 ] && echo "  TIMEOUT $v（渲染没返回，重试 6 次仍失败）" ;;
    esac
  done
done
