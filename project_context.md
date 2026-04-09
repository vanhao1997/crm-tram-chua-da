# Project Context — BSN CRM Dashboard
> Auto-updated bởi team workflows. KHÔNG xóa file này.

## 🎯 Vision
- **Sản phẩm**: BSN CRM Dashboard
- **Mô tả**: Dashboard quản lý lịch hẹn + doanh số + funnel chuyển đổi cho Trạm Chữa Da BSN. Đọc Live data từ Google Sheet (Gviz API).
- **Target users**: Chủ cơ sở spa BSN và nhân viên quản lý
- **Status**: ✅ Live — `https://crm-bsn.vibecodingsolution.ovh`

## 🎨 Brand
- **Primary color**: `#00e5a0` (Emerald Green)
- **Font**: System UI (San Francisco / Segoe UI)
- **Tone**: Professional / Medical Spa
- **Logo**: `public/logo.jpg`

## 🏗️ Tech Stack
- **Frontend**: Vanilla JS + Vite 6.x
- **Backend**: Không cần (Client-side thuần)
- **Data Source**: Google Sheets (Gviz Query API - Read Only)
- **AI Integration**: OpenAI API (`gpt-4o-mini`) — API Key lưu localStorage
- **Hosting**: Coolify v4.0.0-beta.472 trên VPS Contabo (173.249.21.125)
- **Containerization**: Docker (node:20-alpine build → nginx:alpine serve)
- **Domain**: `crm-bsn.vibecodingsolution.ovh` (via Cloudflare Tunnel)

## 📋 Sprint Hiện Tại (Phase 2 — HOÀN THÀNH)
- [x] Thêm Logo + Favicon
- [x] Light / Dark Mode Toggle (localStorage persistence)
- [x] Advanced Global Filtering (Hôm nay, Tuần, Tháng này, Tháng trước)
- [x] Smart Status Parsing (regex quét cột M+ để suy luận trạng thái)
- [x] OpenAI AI Analytics (phân tích lý do rớt lịch)
- [x] Deploy lên Coolify Production

## 📝 Key Decisions
- **2026-04-09**: Chọn Vite + Vanilla JS thay Next.js — Lý do: App đọc data read-only, không cần SSR/backend
- **2026-04-09**: Dùng Google Gviz API thay vì Google Sheets API v4 — Lý do: Không cần OAuth, chỉ cần sheet public
- **2026-04-09**: AI Analytics dùng nút bấm thủ công thay vì auto — Lý do: Tránh tốn token mỗi khi refresh
- **2026-04-09**: Bypass Coolify localhost server (ID=0) bằng cách add server mới "Contabo VPS Pro" — Lý do: Bug Beta v4 gây lỗi 500 trên Destinations

## ⚠️ Constraints & Rules
- Google Sheet PHẢI ở chế độ "Anyone with the link can view"
- Date format trong Google Sheet: `DD/MM/YYYY` (parsed thủ công, không dùng native Date constructor)
- Revenue strings có dấu phân cách (e.g., "94.000.000") → phải strip trước khi parse
- Coolify: KHÔNG dùng server `localhost` (ID=0) — luôn dùng "Contabo VPS Pro"
- Coolify Build Pack: PHẢI chọn `Dockerfile` (không dùng Nixpacks)
- Coolify Ports Exposes: PHẢI đặt `80` (không để mặc định 3000)

## 🐛 Bugs Đã Fix (Quan Trọng)
1. **Date Parsing**: `parseGvizDate` — browser hiểu nhầm DD/MM thành MM/DD → fix bằng split thủ công
2. **Filter Logic**: Tab "KHÁCH ĐÃ ĐẾN" dùng `aptDate` thay vì `date` để lọc theo tháng
3. **Revenue NaN**: Strip dấu `,` và `.` từ chuỗi tiền tệ trước khi parseFloat
4. **Docker vite: Permission denied**: Thêm `chmod -R +x node_modules/.bin/` trong Dockerfile
5. **502 Bad Gateway**: Đổi Ports Exposes từ 3000 → 80 trong Coolify

## 📂 Codebase Structure
```
bsn-dashboard/
├── index.html          # Entry point + HTML structure
├── style.css           # Full CSS (Dark/Light theme, glassmorphism)
├── vite.config.js      # Vite config
├── Dockerfile          # Multi-stage: node build → nginx serve (port 80)
├── package.json        # Dependencies (chỉ có vite devDep)
├── public/logo.jpg     # Logo clinic BSN
└── js/
    ├── main.js          # Core logic: KPI, filters, AI analytics, tabs
    ├── sheets-api.js    # Google Gviz API integration + date parsing
    ├── charts.js        # Canvas charts (Funnel, Doanh thu, Nguồn)
    └── appointments.js  # Bảng lịch hẹn + quá hẹn chưa đến
```

## 🚀 Deployment Info
- **Repo**: `https://github.com/vanhao1997/crm-tram-chua-da`
- **Branch**: `main`
- **VPS**: Contabo — IP `173.249.21.125`, user `root`
- **Coolify Project**: CRM BSN → production → `crm-tram-chua-da`
- **Coolify Server**: "Contabo VPS Pro" (KHÔNG dùng localhost)
- **Cloudflare Tunnel**: Domain `vibecodingsolution.ovh`

## 📂 Docs Index
- Project Context: `project_context.md` (file này)
- Changelog: `CHANGELOG.md`
