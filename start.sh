#!/usr/bin/env bash
# Ai智能企业应用平台 - 本地启动 (Linux / macOS)
# 用法: bash start.sh          启动全部服务（后台运行，日志在 logs/）
#       bash start.sh stop     停止全部服务
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
LOG_DIR="$ROOT/logs"
PID_DIR="$ROOT/.run"
mkdir -p "$LOG_DIR" "$PID_DIR"

command -v node >/dev/null 2>&1 || { echo "[错误] 未找到 Node.js，请先安装"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "[错误] 未找到 pnpm，请先执行: npm i -g pnpm"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[错误] 未找到 python3，请先安装 Python 3.11+"; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[提示] 已从 .env.example 生成 .env，可按需修改后重启脚本"
fi
# 供三个服务进程继承
set -a
. ./.env
set +a

# ---------- stop：停止已启动的后台服务 ----------
if [ "$1" = "stop" ]; then
  shopt -s nullglob
  for f in "$PID_DIR"/*.pid; do
    kill "$(cat "$f")" 2>/dev/null && echo "[停止] $(basename "$f" .pid)" || true
    rm -f "$f"
  done
  echo "全部服务已停止"
  exit 0
fi

# ---------- 依赖（首次运行自动安装） ----------
if [ ! -d apps/web/node_modules ]; then
  echo "[安装] web 依赖..."
  (cd apps/web && pnpm install)
fi
if [ ! -d apps/api/node_modules ]; then
  echo "[安装] api 依赖..."
  (cd apps/api && pnpm install)
fi
if [ ! -x agent-server/.venv/bin/python ]; then
  echo "[安装] Python 虚拟环境与依赖..."
  (cd agent-server && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt)
fi

# ---------- 启动三个服务（后台，日志落 logs/） ----------
echo "[启动] 平台 API  :4000  (logs/api.log)"
(cd apps/api && nohup pnpm dev >"$LOG_DIR/api.log" 2>&1 & echo $! >"$PID_DIR/api.pid")

echo "[启动] Agent     :8100  (logs/agent.log)"
(cd agent-server && nohup .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload >"$LOG_DIR/agent.log" 2>&1 & echo $! >"$PID_DIR/agent.pid")

echo "[启动] Web 前端  :3000  (logs/web.log)"
(cd apps/web && nohup pnpm dev >"$LOG_DIR/web.log" 2>&1 & echo $! >"$PID_DIR/web.pid")

# ---------- 等待平台 API 就绪 ----------
printf "等待平台 API 就绪 "
ok=""
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:4000/api/health >/dev/null 2>&1; then ok=1; break; fi
  printf "."
  sleep 1
done
[ -n "$ok" ] && echo " OK" || { echo ""; echo "[警告] API 30 秒内未就绪，请查看 logs/api.log"; }

echo
echo "=============================================="
echo "  平台入口:  http://localhost:3000"
echo "  API 健康:  http://localhost:4000/api/health"
echo "  默认账号:  ${SEED_ADMIN_EMAIL:-admin@air.local} / ${SEED_ADMIN_PASSWORD:-12345678}"
echo "  日志目录:  logs/  (api / agent / web)"
echo "  停止服务:  bash start.sh stop"
echo "=============================================="
