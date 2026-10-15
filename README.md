# CRM Telesale — Trạm Chữa Da BSN (`crm-bsn`)

Hệ thống CRM tác chiến chi tiết dành riêng cho **đội ngũ Telesale** của **Trạm Chữa Da BSN**, được thiết kế chuyên sâu để gọi điện, phân bổ 5 nhân sự Telesale, chuyển tình trạng số và ghi chú tư vấn trực tiếp trên dữ liệu Google Sheets.

---

## 1. Điểm khác biệt so với bản Owner Overview (`crm-tram-chua-da`)

| Tiêu chí | Bản Chủ Doanh Nghiệp (`crm-tram-chua-da`) | Bản Team Telesale (`crm-bsn` - Repo này) |
| :--- | :--- | :--- |
| **Đối tượng sử dụng** | Chủ doanh nghiệp xem báo cáo tổng quan nhanh | **Đội ngũ Telesale (5 nhân sự)** tác chiến gọi số hàng ngày |
| **Hiển thị dữ liệu** | Chỉ hiển thị biểu đồ & KPI rút gọn (Read-only) | **Bảng dữ liệu chi tiết toàn diện** cho cả 3 Sheet kèm tìm kiếm & bộ lọc đa chiều |
| **Luồng tương tác** | Không có | **Gọi 1 chạm (`tel:`), mở Zalo (`zalo.me`), chọn 5 Telesale (Cột L), đổi Tình trạng (Cột I), ghi Note trực tiếp vào Cột M & lịch sử Care (Cột N+)** |
| **Đồng bộ 3 Sheet** | Chỉ đọc tổng hợp | Đồng bộ trực tiếp với **1) DATA NGUỒN MKT**, **2) KHÁCH ĐẶT HẸN**, **3) KHÁCH ĐÃ ĐẾN** |

---

## 2. Kết nối 3 Sheet từ Google Spreadsheet `DATA - BSN`

- **Google Sheet gốc**: [`1HEOYV5QzcOAHSMr6x5zeuem1Vi3V9QdeTvF6lKhGLgk`](https://docs.google.com/spreadsheets/d/1HEOYV5QzcOAHSMr6x5zeuem1Vi3V9QdeTvF6lKhGLgk/edit?usp=sharing)
- **3 Sheet được đồng bộ**:
  1. **`1) DATA NGUỒN MKT`** (`gid=915093349`) — Danh sách data từ Marketing tự động đổ về.
  2. **`2) KHÁCH ĐẶT HẸN`** (`gid=2007161241`) — Danh sách khách đang có lịch hẹn cần nhắc lịch / chăm sóc.
  3. **`3) KHÁCH ĐÃ ĐẾN`** (`gid=1566321838`) — Danh sách khách đã đến cơ sở kèm Thứ (Cột V) & Doanh số (Cột W).

### Quy ước Cột tương tác của Telesale:
- **Cột H (`index 7`)**: Thông tin khách hàng (Tên xưng hô, năm sinh, khu vực/địa chỉ).
- **Cột I (`index 8`)**: **Tình trạng số** (`Chưa gọi`, `ĐẶT HẸN`, `Hẹn Gọi Lại`, `Nhu Cầu`, `Không Nghe Máy`, `Thuê Bao`, `DỜI LỊCH`, `HỦY LỊCH`, `Từ Chối`, `Không Hoàn Thành`, `Ở xa`, `Sai Số`, `ĐÃ ĐẾN`).
- **Cột J & K (`index 9, 10`)**: Giờ hẹn & Ngày hẹn (`DD/MM/YYYY`).
- **Cột L (`index 11`)**: **Nhân sự Telesale phụ trách** — Chọn từ danh sách **5 người** (`THỊNH`, `PHÚ`, `TELESALE 3`, `TELESALE 4`, `TELESALE 5` — có thể đổi tên trực tiếp trong mục **⚙️ Cài đặt 5 Telesale**).
- **Cột M (`index 12`)**: **Note tư vấn chính** của Telesale (hỗ trợ sửa nhanh ngay trên dòng hoặc qua ngăn trượt `CallDrawer` kèm các mẫu câu nhanh và tự động chèn giờ gọi).

---

## 3. Cách chạy ứng dụng

Dự án được xây dựng tối ưu không phụ thuộc thư viện ngoài ở runtime (chạy trực tiếp bằng Node.js tích hợp sẵn):

```bash
# Chạy máy chủ CRM (API + Giao diện Web tại http://localhost:3001)
node server/index.js
```

Sau khi chạy, mở trình duyệt tại: **`http://localhost:3001`**

### Chạy kiểm thử (Unit Tests):
```bash
node --test tests/*.test.js
```

---

## 4. Hướng dẫn kích hoạt Ghi 2 Chiều lên Google Sheet (`google-apps-script.js`)

Mặc định, mọi thao tác chọn Telesale (Cột L), đổi Tình trạng (Cột I) và ghi Note (Cột M) đều được **lưu tức thì** vào cơ sở dữ liệu cục bộ (`server/data/local-state.json`). Để hệ thống tự động ghi ngược lên đúng ô trên Google Sheet:

1. Mở giao diện CRM ➔ Bấm nút **`⚙️ Cài đặt 5 Telesale & Đồng bộ`** trên thanh Header ➔ Bấm **`📋 Copy mã google-apps-script.js`** (hoặc mở file [`google-apps-script.js`](./google-apps-script.js)).
2. Mở Google Sheet **DATA - BSN** ➔ **Tiện ích mở rộng (Extensions)** ➔ **Apps Script**.
3. Dán toàn bộ mã vào `Code.gs` và nhấn **Lưu**.
4. Nhấn **Triển khai (Deploy)** ➔ **Tạo mục triển khai mới (New deployment)** ➔ Chọn **Ứng dụng web (Web app)**:
   - *Thực thi dưới dạng*: **Tôi (Me)**
   - *Ai có quyền truy cập*: **Bất kỳ ai (Anyone)**
5. Copy URL Web App nhận được và dán vào ô **URL Google Apps Script Web App** trong mục Cài đặt của CRM (hoặc biến `GOOGLE_APPS_SCRIPT_URL` trong file `.env`).
