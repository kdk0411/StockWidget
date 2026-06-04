@echo off
chcp 65001 >nul
rem StockWidget 실행 (로그가 보이는 버전)
cd /d "%~dp0"

rem 이 PC 환경변수 ELECTRON_RUN_AS_NODE=1 해제 (안 그러면 GUI 대신 Node로 실행됨)
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\electron\dist\electron.exe" (
  echo [안내] 먼저 의존성을 설치하세요:  npm install
  pause
  exit /b 1
)

echo StockWidget 실행 중... (이 창을 닫으면 위젯도 종료됩니다)
".\node_modules\electron\dist\electron.exe" .
