@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo   Ai智能企业应用平台 - 本地启动 (Windows)
echo ==============================================

where node >nul 2>nul || (echo [错误] 未找到 Node.js，请先安装 & pause & exit /b 1)
where pnpm >nul 2>nul || (echo [错误] 未找到 pnpm，请先执行: npm i -g pnpm & pause & exit /b 1)
where python >nul 2>nul || (echo [错误] 未找到 Python，请先安装 Python 3.11+ & pause & exit /b 1)

if not exist .env (
  copy .env.example .env >nul
  echo [提示] 已从 .env.example 生成 .env，可按需修改后重启脚本
)

rem 读取根目录 .env（KEY=VALUE，# 开头为注释），供三个服务进程继承
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
if not defined SEED_ADMIN_EMAIL set "SEED_ADMIN_EMAIL=admin@air.local"
if not defined SEED_ADMIN_PASSWORD set "SEED_ADMIN_PASSWORD=12345678"

rem ---------- 依赖（首次运行自动安装） ----------
if not exist "apps\web\node_modules" (
  echo [安装] web 依赖...
  pushd apps\web
  call pnpm install
  popd
)
if not exist "apps\api\node_modules" (
  echo [安装] api 依赖...
  pushd apps\api
  call pnpm install
  popd
)
if not exist "agent-server\.venv\Scripts\python.exe" (
  echo [安装] Python 虚拟环境与依赖...
  pushd agent-server
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  popd
)

rem ---------- 启动三个服务（各自独立窗口） ----------
echo [启动] 平台 API  :4000
start "AIR-API" cmd /k "cd /d %~dp0apps\api && pnpm dev"

echo [启动] Agent     :8100
start "AIR-AGENT" cmd /k "cd /d %~dp0agent-server && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload"

echo [启动] Web 前端  :3000
start "AIR-WEB" cmd /k "cd /d %~dp0apps\web && pnpm dev"

timeout /t 8 /nobreak >nul
echo.
echo ==============================================
echo   平台入口:  http://localhost:3000
echo   API 健康:  http://localhost:4000/api/health
echo   默认账号:  %SEED_ADMIN_EMAIL% / %SEED_ADMIN_PASSWORD%
echo ----------------------------------------------
echo   停止服务: 关闭 AIR-API / AIR-AGENT / AIR-WEB 三个窗口
echo ==============================================
pause
