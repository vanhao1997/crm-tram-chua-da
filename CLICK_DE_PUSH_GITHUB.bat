@echo off
chcp 65001 >nul
title Deploy CRM Tram Chua Da BSN -> GitHub & Copy Apps Script
cd /d "%~dp0"

echo ==============================================================
echo 1. DANG COPY MA NGUON GOOGLE APPS SCRIPT VAO CLIPBOARD...
echo ==============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Raw -Encoding UTF8 'google-apps-script.js' | Set-Clipboard"
echo [OK] Da copy toan bo file google-apps-script.js vao Clipboard!
echo      Ban chi can qua tab Apps Script cua Google Sheet va bam Ctrl+A roi Ctrl+V.
echo.

echo ==============================================================
echo 2. DANG PUSH CODE LEN GITHUB (vanhao1997/crm-tram-chua-da)...
echo ==============================================================
if not exist ".git" (
  git init
  git branch -M main
)

git remote remove origin >nul 2>&1
git remote add origin https://github.com/vanhao1997/crm-tram-chua-da.git

git add -A
git commit -m "feat(crm): admin add Messenger lead (cols B-K), auto-sync Sheet 2 Booked & Sheet 3 Arrived + Col W revenue" --allow-empty
git branch -M main
git push -u origin main --force

if %ERRORLEVEL% EQU 0 (
  echo.
  echo ==============================================================
  echo [THANH CONG] Da push code len https://github.com/vanhao1997/crm-tram-chua-da
  echo Bay gio ban chi can bam nut "Deploy / Redeploy" tren tab Coolify!
  echo ==============================================================
) else (
  echo.
  echo [LOI] Khong the push tu dong. Vui long kiem tra dang nhap Git tren may.
)

pause
