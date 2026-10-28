@echo off
chcp 65001 >nul
setlocal
echo ============================================
echo   FundMerge 合资金账 - 一键构建
echo ============================================

cd /d "%~dp0"

echo [1/4] 检查 node_modules ...
if not exist "node_modules" (
  echo   未安装依赖，开始 npm install ...
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  call npm install
  if errorlevel 1 goto FAIL
) else (
  echo   依赖已存在，跳过
)

echo [2/4] 结束可能占用产物的进程 ...
taskkill /F /IM 合资金账.exe >nul 2>&1

echo [3/4] 构建到 dist ...
call node node_modules\electron-builder\cli.js --win --x64 --config.directories.output=dist
if errorlevel 1 goto FAIL

echo [4/4] 运行发版门禁 ...
where sh >nul 2>&1
if %errorlevel%==0 (
  sh deliverables/pack-gate.sh --self-test
  sh deliverables/pack-gate.sh dist
  if errorlevel 1 (
    echo.
    echo [门禁] FAIL - 产物不可发布，请查看上方输出
    goto FAIL
  )
) else (
  node deliverables/pack-scan.js dist
  if errorlevel 1 goto FAIL
)

echo.
echo ============================================
echo   构建完成
echo   安装包：dist\FundMerge-Setup-*.exe
echo ============================================
pause
exit /b 0

:FAIL
echo.
echo *** 构建或门禁失败，请查看上方错误 ***
pause
exit /b 1
