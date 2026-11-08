@echo off
setlocal
cd /d "%~dp0.."
if not exist "dist-electron\main.cjs" (
  echo Build the development app with npm run build first.
  pause
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE="
set "NBSX_DEV_URL="
set "NBSX_TEST_USER_DATA=%CD%\.local\drum-trial\profile"
if exist ".local\drum-trial\drum-mapping-trial.nbsx" (
  "node_modules\electron\dist\electron.exe" . ".local\drum-trial\drum-mapping-trial.nbsx" "--user-data-dir=%NBSX_TEST_USER_DATA%"
) else (
  "node_modules\electron\dist\electron.exe" . "--user-data-dir=%NBSX_TEST_USER_DATA%"
)
endlocal
