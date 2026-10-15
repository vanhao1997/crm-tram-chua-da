# Script tự động khởi tạo Git và Push lên https://github.com/vanhao1997/crm-tram-chua-da
$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}

$remoteUrl = "https://github.com/vanhao1997/crm-tram-chua-da.git"
$existingRemotes = git remote
if ($existingRemotes -contains "origin") {
  git remote set-url origin $remoteUrl
} else {
  git remote add origin $remoteUrl
}

git add -A
git commit -m "feat(crm): unified Sales CRM Telesale & Admin CEO Overview + Apps Script v2" --allow-empty
git push -u origin main --force

Write-Host "✅ Đã push thành công lên $remoteUrl (nhánh main)!" -ForegroundColor Green
