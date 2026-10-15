@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================================
echo   KHOI DONG CRM TELESALE - TRAM CHUA DA BSN
echo   Dia chi truy cap: http://localhost:3001
echo ==============================================================
start "" "http://localhost:3001"
node server/index.js
pause
