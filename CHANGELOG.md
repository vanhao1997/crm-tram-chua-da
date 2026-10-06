# Changelog

## [2026-10-06 Appointment Overview]
### Added
- Add selected-period past-appointment count inside the appointment KPI.
- Show upcoming appointments and appointments elapsed in the latest seven Vietnam calendar days.
- Render compact cards from the existing overview request, with five visible items and expandable remaining items (20 per list maximum).
- Preserve recorded status and identify confirmed-lead events without inferring no-shows; match visits only by event identity or exact phone/day.
- Exclude phone numbers and private notes from appointment summaries and label stale/unavailable schedules.

## [2026-10-06 Overview]
### Changed
- Replace the CRM and Marketing detail screens with one aggregate overview.
- Load one compact overview response instead of all customer and Marketing rows.
- Remove Chart.js, detail tables, record actions, comparison charts and budget analysis from overview loading.
- Compute period totals on the server while preserving Vietnam dates, future booking counts, missing revenue and source freshness warnings.
- Cache fingerprinted JS/CSS assets for repeat visits and revalidate HTML after deployments.
- Load a 144px WebP brandmark instead of the original 2048px JPEG.

## [2026-10-06]
### Fixed
- Resolve CRM sources by numeric Google tab ID after tab renaming.
- Calculate Marketing customer metrics from the same fresh CRM snapshot, with explicit source discrepancy warnings.
- Complete missing appointment events from confirmed leads without changing Sheets or inferring arrivals or payments.
- Use lead date B, appointment date K, visit date K with B fallback, and numeric W/V revenue consistently.
- Recalculate selected-period financial totals and daily-only subtotals; label received minus cost separately from Ads wallet balance.
- Expire stale source snapshots after 15 minutes and reconcile sources on refresh and every five minutes.
- Block budget recommendations when source data is unavailable or current-month visits are not recorded.

### Removed
- Browser and server AI analysis integration, provider route, configuration, and credentials in Coolify.

### Deferred
- Native Sheet formula repair and persisted record UUIDs require write access. This release keeps Sheets read-only and retains existing public access.

## [2026-04-16]
### Added
- Tính năng Global Search theo \`name\` và \`phone\`.
- Bộ lọc khoảng ngày tuỳ chỉnh (Custom Date Range Picker).
- Button Gọi điện và Zalo tích hợp thẳng vào bảng CRM kèm Inline SVG Icons.
- Biểu đồ Doughnut (Pie Chart) hiển thị Tỷ trọng Doanh Thu theo dịch vụ bằng thư viện \`Chart.js\`.

### Changed
- Cấu trúc thư mục được refactor sang Clean Architecture (\`src/features\`, \`src/core/api\`).
- Thay thế emojis điện thoại sang các \`.action-btn\` với hover CSS animation và Inline SVG SVG parsing.

### Fixed
- Lỗi Asset Resolution build Vite đối với file ảnh \`.svg\` khi mount từ chuỗi template literal JS string.
