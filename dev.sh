#!/usr/bin/env bash
# 本地调试用：不走 docker，直接在本机跑后端（同时由它托管 frontend 静态文件）。
#
#   ./dev.sh              # http://127.0.0.1:8655
#   PORT=9000 ./dev.sh    # 换端口
#   HOST=0.0.0.0 ./dev.sh # 允许局域网访问
#   RELOAD=0 ./dev.sh     # 关掉自动重载
#
# 前端不需要单独的 server：后端把 frontend/ 挂在 /，同源，没有 CORS 问题；
# 改前端文件直接刷新浏览器即可，改后端会自动重启。

set -euo pipefail
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8655}"
RELOAD="${RELOAD:-1}"
VENV="${VENV:-.venv}"
REQ="backend/requirements.txt"

# bleak 0.22.3 在 3.13+ 上装不上，优先挑 3.11/3.12
pick_python() {
  for cand in python3.11 python3.12 python3.10 python3.9 python3; do
    local bin
    bin="$(command -v "$cand" || true)"
    [ -n "$bin" ] || continue
    if "$bin" -c 'import sys; sys.exit(0 if (3,9) <= sys.version_info < (3,13) else 1)' 2>/dev/null; then
      echo "$bin"
      return 0
    fi
  done
  return 1
}

if [ ! -x "$VENV/bin/python" ]; then
  PY="$(pick_python)" || {
    echo "找不到可用的 Python（需要 3.9 ~ 3.12，bleak 0.22.3 不支持 3.13+）" >&2
    echo "macOS 可以 brew install python@3.11 后重跑本脚本" >&2
    exit 1
  }
  echo "==> 用 $PY 创建虚拟环境 $VENV"
  "$PY" -m venv "$VENV"
fi

echo "==> 检查依赖（${REQ}）"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
# 已装齐时 pip install 是秒回的空操作，所以每次都跑一遍，免得漏装
"$VENV/bin/python" -m pip install --quiet -r "$REQ"

export EPD_FRONTEND_DIR="$PWD/frontend"
export EPD_DATA_DIR="${EPD_DATA_DIR:-$PWD/data}"
mkdir -p "$EPD_DATA_DIR"

ARGS=(backend.app.main:app --host "$HOST" --port "$PORT")
if [ "$RELOAD" != "0" ]; then
  ARGS+=(--reload --reload-dir backend)
fi

echo "==> 前端 + API: http://${HOST}:${PORT}/    调试模式: http://${HOST}:${PORT}/?debug=true"
echo "==> 设备记忆文件: $EPD_DATA_DIR/devices.json"
echo "==> 蓝牙走本机适配器（macOS 首次扫描会弹权限申请；Linux 需要 BlueZ 在跑）"
exec "$VENV/bin/uvicorn" "${ARGS[@]}"
