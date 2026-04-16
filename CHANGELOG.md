# Changelog

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
