# Marketing Dashboard Specification (BSN Trạm Chữa Da)

## 1. Executive Summary
Thêm một phân hệ mới trên BSN Dashboard để quản lý ngân sách Marketing, chi phí chạy quảng cáo (Ads), và phễu chuyển đổi khách hàng từ DATA -> LỊCH HẸN -> KHÁCH TỚI -> DOANH SỐ. Phân hệ mới sẽ lấy dữ liệu từ sheet "2026" chứa các số liệu quảng cáo theo chi tiết từng dịch vụ.

## 2. User Stories
- Là một nhà quản lý, tôi muốn xem tổng quan ngân sách Marketing (tổng nhận, chi phí quảng cáo, phí quản lý, số dư).
- Là một nhà quản lý, tôi muốn xem Phễu Marketing (tổng DATA -> ra bao nhiêu LỊCH HẸN -> ra bao nhiêu KHÁCH TỚI) chia theo từng hạng mục dịch vụ (Nâng cơ, Mũi chỉ, Khác).
- Là một nhà quản lý, tôi muốn xem các chỉ số Cost Analysis: Giá 1 Data, Giá 1 Lịch Hẹn, Giá 1 Khách tới.
- Là một nhà quản lý, tôi muốn đo lường Tỷ lệ Chi phí / Doanh thu trên cùng một màn hình để đánh giá hiệu quả chiến dịch.

## 3. Database Design / Data Source
- **Data Source**: Google Sheet (ID: `124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4`, sheet: `2026`)
- **Structure**: 
  - Group 1: Dữ liệu chi tiết về chi phí bao gồm Số dư còn, Tổng nhận, Chi phí chạy ADS, Phí quản lý, Tổng chi phí.
  - Group 2 (Phễu CĐ): Tách theo 3 dịch vụ Nâng cơ, Mũi chỉ, Khác qua từng giai đoạn DATA, LỊCH HẸN, KHÁCH TỚI.
  - Group 3 (Kết quả): Doanh số, FAIL, Giá 1 DATA, Giá 1 Lịch hẹn, Giá 1 khách tới, Tỷ lệ chi phí / Doanh thu.

## 4. UI Components
Giao diện dự kiến bao gồm 3 phần chính:
1. **Financial Overview (KPI Cards)**:
   - Tổng Khách Tới / Tổng Doanh thu
   - Chi Phí / Doanh thu (%)
   - Tổng Chi Phí Quảng Cáo
2. **Funnel Charts (Biểu đồ phễu)**:
   - Sử dụng dạng Biểu đồ phễu (ApexCharts) hiển thị hành trình từ: Nâng cơ (Data -> Lịch -> Khách tới), và tương tự cho Mũi chỉ.
3. **Daily Performance Table**:
   - Bảng raw data chi tiết từng ngày, có chức năng toggle hiện/ẩn các nhóm cột dịch vụ để dễ nhìn.

## 5. Technical Approach
- Dùng thuật toán parse CSV nhiều layer (multi-header) để tự động convert data thành JSON phẳng.
- Dùng ApexCharts để dựng Funnel Chart.
- Thêm section menu navigation giữa CRM Analytics và Marketing Analytics.

## 6. Build Checklist (Kế hoạch Triển khai)
- [ ] Thêm file `js/marketing-api.js` để parse dữ liệu marketing.
- [ ] Xây dựng file HTML `marketing.html` (hoặc switch tabs trong `index.html`).
- [ ] Cài đặt ApexCharts và vẽ biểu đồ Phễu.
- [ ] Xây dựng bảng hiển thị dữ liệu Marketing từng ngày.
- [ ] Liên kết Sidebar để người dùng chuyển qua lại dễ dàng.
