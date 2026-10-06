# Project Context — BSN CRM Dashboard
> Auto-updated bởi team workflows. KHÔNG xóa file này.

## 🎯 Vision
- **Sản phẩm**: BSN CRM Dashboard
- **Mô tả**: Tổng quan CRM, doanh số và tài chính Marketing cho Trạm Chữa Da BSN. Đọc Google Sheets qua backend read-only.
- **Target users**: Chủ cơ sở spa BSN và nhân viên quản lý
- **Status**: ✅ Live — `https://crm-bsn.vibecodingsolution.ovh`

## 🎨 Brand
- **Primary color**: `#123e34` (Forest Green), `#efe1bd` (Champagne)
- **Font**: System UI (San Francisco / Segoe UI)
- **Tone**: Professional / Medical Spa
- **Logo tổng quan**: `public/brandmark.webp` (144px)

## 🏗️ Tech Stack
- **Frontend**: Vanilla JS + Vite 6.x
- **Backend**: Node/Express proxy đọc Google Sheets read-only, cache snapshot, kiểm tra toàn vẹn dữ liệu
- **Data Source**: Google Sheets API v4; giao diện dùng endpoint tổng hợp `/api/overview`, không tải danh sách khách hàng
- **AI Integration**: Đã loại bỏ để giảm bundle và tránh phụ thuộc API AI
- **Hosting**: Coolify v4.0.0-beta.472 trên VPS Contabo (173.249.21.125)
- **Containerization**: Docker (node:20-alpine build và Node/Express runtime, port 3000)
- **Domain**: `crm-bsn.vibecodingsolution.ovh` (via Cloudflare Tunnel)

## 📋 Trạng thái giao diện tổng quan
- [x] Giữ các chỉ số tổng quan CRM, tài chính Marketing và cảnh báo dữ liệu.
- [x] Giữ bộ lọc kỳ: hôm nay, tuần này, tháng này, tháng trước, tất cả và tùy chọn.
- [x] Gỡ bảng chi tiết, tìm kiếm khách, modal, action từng khách, Chart.js và phân tích AI khỏi luồng tải chính.
- [x] Giao diện gọi một endpoint tổng hợp `/api/overview` thay vì tải nhiều nguồn thô.

## 📝 Key Decisions
- **2026-04-16**: Áp dụng Clean Architecture chia module \`src/features\` và \`src/core/api\` dễ manage hơn.
- **2026-04-16**: Dùng Inline SVG thay vì file qua \`<img>\` để tránh Vite build path issue không render được asset tĩnh ở prod chạy JS.
- **2026-04-09**: Chọn Vite + Vanilla JS thay Next.js — Lý do: App đọc data read-only, không cần SSR/backend
- **2026-04-09**: Dùng Google Gviz API thay vì Google Sheets API v4 — Lý do: Không cần OAuth, chỉ cần sheet public
- **2026-10-06**: Loại bỏ AI Analytics — Lý do: giảm bundle, giảm chi phí và tránh phụ thuộc API AI
- **2026-10-06**: Chuyển sang màn hình tổng quan, một API theo kỳ; bỏ bảng chi tiết, Chart.js và phân tích ngân sách khỏi luồng tải trang. Giữ Sheets chỉ đọc, cảnh báo dữ liệu và cách truy cập hiện tại.
- **2026-04-09**: Bypass Coolify localhost server (ID=0) bằng cách add server mới "Contabo VPS Pro" — Lý do: Bug Beta v4 gây lỗi 500 trên Destinations

## ⚠️ Constraints & Rules
- Tài khoản dịch vụ cần quyền đọc hai Google Sheets; giữ quyền chia sẻ hiện tại theo yêu cầu người dùng.
- Giao diện tự làm mới mỗi 5 phút; backend cache nguồn 60 giây, snapshot cũ hết hạn sau 15 phút.
- Date format trong Google Sheet: `DD/MM/YYYY` (parsed thủ công, không dùng native Date constructor)
- Revenue strings có dấu phân cách (e.g., "94.000.000") → phải strip trước khi parse
- Coolify: KHÔNG dùng server `localhost` (ID=0) — luôn dùng "Contabo VPS Pro"
- Coolify Build Pack: PHẢI chọn `Dockerfile` (không dùng Nixpacks)
- Coolify Ports Exposes: `3000`, health check `/api/health/live`.

## 🐛 Bugs Đã Fix (Quan Trọng)
1. **Date Parsing**: `parseGvizDate` — browser hiểu nhầm DD/MM thành MM/DD → fix bằng split thủ công
2. **Filter Logic**: Tab "KHÁCH ĐÃ ĐẾN" dùng `aptDate` thay vì `date` để lọc theo tháng
3. **Revenue NaN**: Strip dấu `,` và `.` từ chuỗi tiền tệ trước khi parseFloat
4. **Docker vite: Permission denied**: Thêm `chmod -R +x node_modules/.bin/` trong Dockerfile
5. **502 Bad Gateway**: chuẩn hóa runtime Express port `3000` và health check `/api/health/live` trong Coolify

## 📂 Codebase Structure
```
crm-tram-chua-da/
├── index.html                    # Tổng quan CRM và tài chính
├── marketing.html                # Chuyển đến tổng quan tài chính
├── vite.config.js                # Vite build
├── Dockerfile                    # Node build và Express runtime
├── public/brandmark.webp         # Logo tối ưu dung lượng
├── src/main.js                   # Bộ lọc, số tổng và cảnh báo
├── src/assets/overview.css       # Giao diện tổng quan
├── src/core/api/overview-api.js  # Một request tổng hợp theo kỳ
└── server/
    ├── app.js                    # API và static assets
    ├── overview.js               # Tính tổng theo ngày Việt Nam
    └── sheets-service.js         # Snapshot, cache và đối soát chỉ đọc
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
