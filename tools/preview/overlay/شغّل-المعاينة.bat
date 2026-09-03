@echo off
chcp 65001 >nul
title معاينة سهل — محلي
cd /d "%~dp0"

echo.
echo   ====================================================
echo    معاينة سهل — داتا وهمية، صفر اتصال بالداتابيز
echo   ====================================================
echo.

set PORT=8899

where py >nul 2>nul && (
  echo   بيشغّل السيرفر على http://localhost:%PORT%
  start "" http://localhost:%PORT%/index.html
  py -3 _preview\spa-server.py %PORT% .
  goto :eof
)

where python >nul 2>nul && (
  echo   بيشغّل السيرفر على http://localhost:%PORT%
  start "" http://localhost:%PORT%/index.html
  python _preview\spa-server.py %PORT% .
  goto :eof
)

where npx >nul 2>nul && (
  echo   مفيش Python — بنستخدم Node
  start "" http://localhost:%PORT%/index.html
  npx --yes serve -l %PORT% .
  goto :eof
)

echo.
echo   [!] مفيش Python ولا Node على الجهاز.
echo       نزّل Python من python.org وجرّب تاني،
echo       أو افتح الملف ده من أي سيرفر محلي عندك.
echo.
pause
