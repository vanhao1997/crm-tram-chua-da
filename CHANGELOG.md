# Changelog — BSN CRM Dashboard

## [2026-04-09] — Phase 2 Complete + Production Deploy

### Added
- 🎨 Brand Identity: Logo clinic BSN + responsive CSS
- 🌗 Theme Engine: Light/Dark mode toggle với localStorage persistence
- 📊 Advanced Global Filtering: Hôm nay, Tuần này, Tháng này, Tháng trước
- 🤖 Smart Status Parsing: Regex quét cột M+ để suy luận trạng thái lead
- 🧠 AI Analytics: Tích hợp OpenAI (gpt-4o-mini) phân tích lý do rớt lịch
- 🐳 Dockerfile: Multi-stage build (node:20-alpine → nginx:alpine)

### Fixed
- 📅 Date Parsing: Fix `parseGvizDate` khi Google Sheets trả chuỗi DD/MM/YYYY
- 🔄 Filter Logic: Chuyển cột lọc "KHÁCH ĐÃ ĐẾN" từ `date` sang `aptDate`
- 💰 Revenue Parsing: Fix NaN khi tính doanh thu do dấu phân cách (`,`, `.`)
- 🐳 Docker Build: Fix `vite: Permission denied` bằng chmod + npx
- 🌐 Coolify 502: Fix port mismatch (3000 → 80) trong Coolify config

### Deployed
- ✅ Live tại `https://crm-bsn.vibecodingsolution.ovh`
- 🏗️ Coolify v4.0.0-beta.472 trên VPS Contabo
- ☁️ SSL via Cloudflare Tunnel

---

## [2026-04-09] — Phase 1: Initial Build

### Added
- 📊 KPI Cards: Tổng Lead, Đặt Hẹn, Đã Đến, Doanh Số
- 📅 Bảng Lịch Hẹn: Tab Hôm nay / Tuần này / Tháng này
- ⚠️ Bộ lọc "Quá hẹn chưa đến"
- 📈 Charts: Funnel chuyển đổi, Doanh thu theo tháng, Nguồn khách
- 🔄 Auto-refresh timer (1h interval)
- 🔗 Google Sheets Gviz API integration
