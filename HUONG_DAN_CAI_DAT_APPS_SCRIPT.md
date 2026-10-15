# HƯỚNG DẪN CÀI ĐẶT GOOGLE APPS SCRIPT & BOT TELEGRAM NHẮC LỊCH HẸN
**(Hệ thống CRM Telesale — Trạm Chữa Da BSN)**

Tài liệu này hướng dẫn chi tiết **2 tính năng cốt lõi**:
1. **Đồng bộ 2 chiều từ Web CRM về Google Sheet** (lưu đầy đủ **Tình trạng, Lịch hẹn, Telesale, Ghi chú** và tự động đẩy khách sang **Sheet `2) KHÁCH ĐẶT HẸN`** & **Sheet `3) KHÁCH ĐÃ ĐẾN`**).
2. **Cài đặt Bot Telegram** tự động bắn danh sách khách có lịch hẹn hôm nay vào nhóm Telegram lúc **08:00 sáng mỗi ngày** (hoặc bấm nút **"Gửi Telegram"** ngay trên Web CRM).

---

## PHẦN 1: CÀI ĐẶT APPS SCRIPT ĐỒNG BỘ WEB CRM ⇄ GOOGLE SHEET (3 TABS)

Khi cài đặt xong kịch bản trong file [`google-apps-script.js`](./google-apps-script.js), mọi thao tác của Telesale trên giao diện Web sẽ tự động lưu trực tiếp vào Google Sheet theo cơ chế sau:

| Trường trên Web CRM | Cột trên Google Sheet | Cơ chế đồng bộ tự động giữa 3 Sheet |
| :--- | :--- | :--- |
| **Thông tin KH** | **Cột H** | Cập nhật tại Sheet đang mở + đồng bộ sang Sheet 2 & Sheet 3 (nếu SĐT đã có mặt). |
| **Tình trạng** | **Cột I** | • Chọn **`ĐẶT HẸN`** / **`DỜI LỊCH`** (hoặc chọn Ngày hẹn): Tự động copy khách từ `1) DATA NGUỒN MKT` sang **`2) KHÁCH ĐẶT HẸN`**.<br>• Chọn **`ĐÃ ĐẾN`**: Tự động copy khách sang **`3) KHÁCH ĐÃ ĐẾN`**.<br>• Nếu SĐT đã có sẵn ở Sheet 2 / Sheet 3 thì cập nhật dòng cũ, **không tạo dòng trùng**. |
| **Giờ hẹn** | **Cột J** | Lưu định dạng giờ (`09:30`, `14:00`...) đồng bộ trên cả Sheet 1 và Sheet 2. |
| **Ngày đặt lịch hẹn** | **Cột K** | Lưu định dạng chuẩn `dd/mm/yyyy` đồng bộ trên cả Sheet 1, Sheet 2 và Sheet 3. |
| **Telesale phụ trách** | **Cột L** | Lưu tên nhân sự Telesale đồng bộ trên cả 3 Sheet (`MKT`, `KHÁCH ĐẶT HẸN`, `KHÁCH ĐÃ ĐẾN`). |
| **Ghi chú tư vấn** | **Cột M** | Lưu toàn bộ nội dung ghi chú nhiều dòng đồng bộ trên cả 3 Sheet. |

---

### Các bước cài đặt trên Google Sheet:

#### Bước 1: Mở trình soạn thảo Apps Script
1. Mở file Google Sheet **DATA - BSN** bằng tài khoản Google có quyền **Chỉnh sửa (Editor)**.
2. Trên thanh menu trên cùng, chọn **Tiện ích mở rộng (Extensions)** ➔ **Apps Script**.

#### Bước 2: Dán mã nguồn `google-apps-script.js`
1. Trong cửa sổ **Apps Script** vừa mở, nhìn sang cột bên trái chọn file **`Mã.gs`** (hoặc `Code.gs`).
2. **Xóa toàn bộ** đoạn code mặc định `function myFunction() {}` bên trong.
3. Mở file [`google-apps-script.js`](./google-apps-script.js) trong thư mục dự án CRM này, copy **toàn bộ nội dung** và dán vào cửa sổ `Mã.gs`.
4. Nhấn **`Ctrl + S`** (hoặc bấm biểu tượng đĩa mềm 💾) để lưu dự án, đặt tên là **`CRM-BSN-Webhook`**.

#### Bước 3: Triển khai (Deploy) thành Web App URL
1. Ở góc trên bên phải màn hình Apps Script, bấm nút màu xanh **Triển khai (Deploy)** ➔ chọn **Tùy chọn triển khai mới (New deployment)**.
2. Bấm vào biểu tượng **Bánh răng ⚙️** cạnh dòng *"Chọn loại (Select type)"* ➔ chọn **Ứng dụng web (Web app)**.
3. Điền cấu hình như sau:
   - **Mô tả (Description)**: `CRM BSN Sync v2 & Telegram Bot`
   - **Thực thi dưới dạng (Execute as)**: Chọn **Tôi (Me - email của bạn)**
   - **Ai có quyền truy cập (Who has access)**: Chọn **Bất kỳ ai (Anyone)** *(Bắt buộc chọn "Bất kỳ ai" để Web Server CRM gửi dữ liệu qua được mà không bị chặn quyền đăng nhập)*.
4. Bấm **Triển khai (Deploy)**.
5. Cấp quyền truy cập khi Google hỏi:
   - Bấm **Ủy quyền truy cập (Authorize access)** ➔ Chọn tài khoản Google của bạn.
   - Bấm **Nâng cao (Advanced)** ở góc dưới bên trái ➔ Chọn **Đi tới CRM-BSN-Webhook (không an toàn) / Go to CRM-BSN-Webhook (unsafe)** ➔ Bấm **Cho phép (Allow)**.
6. Sau khi hoàn tất, Google sẽ hiển thị **URL ứng dụng web (Web app URL)** có dạng:
   ```text
   https://script.google.com/macros/s/AKfycbx.../exec
   ```
   👉 Hãy bấm **Sao chép (Copy)** đường link này.

#### Bước 4: Dán URL vào file `.env` của Web CRM
1. Trong thư mục dự án `crm-bsn`, tạo file `.env` (copy từ `.env.example` nếu chưa có).
2. Dán đường link vừa copy vào dòng `GOOGLE_APPS_SCRIPT_URL`:
   ```env
   PORT=3001
   GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbx.../exec
   ```
3. Khởi động lại server CRM (`npm run dev`). Từ lúc này, mọi chỉnh sửa trên Web CRM đều được ghi thẳng vào cả 3 tab trên Google Sheet!

> [!IMPORTANT]
> **Lưu ý khi cập nhật code Apps Script sau này:**
> Mỗi khi bạn sửa nội dung trong `Mã.gs` (ví dụ điền thêm Token Telegram), bạn cần bấm **Triển khai (Deploy)** ➔ **Quản lý các bản triển khai (Manage deployments)** ➔ Bấm biểu tượng **Bút chì ✏️ (Chỉnh sửa)** ➔ Ở mục **Phiên bản (Version)** chọn **Phiên bản mới (New version)** ➔ Bấm **Triển khai (Deploy)** để áp dụng code mới mà không làm đổi URL.

---

## PHẦN 2: HƯỚNG DẪN CÀI ĐẶT BOT TELEGRAM GỬI LỊCH HẸN HÔM NAY

Hệ thống hỗ trợ **cả 2 chế độ gửi Telegram**:
- **Tự động mỗi sáng 08:00**: Chạy trực tiếp trên máy chủ Google (thông qua Apps Script), **không cần bật máy tính cá nhân**.
- **Gửi tức thì bằng 1 cú click**: Bấm nút **"Gửi Telegram"** ngay trên thanh nhắc lịch của Web CRM hoặc từ menu trên Google Sheet.

### Bước 1: Tạo Bot Telegram (Mất 1 phút)
1. Mở ứng dụng **Telegram**, tìm kiếm tài khoản chính chủ **`@BotFather`** (có dấu tích xanh).
2. Nhắn lệnh:
   ```text
   /newbot
   ```
3. Nhập **Tên hiển thị của Bot** (ví dụ: `Nhắc Lịch Hẹn BSN`).
4. Nhập **Username của Bot** (phải kết thúc bằng chữ `bot`, ví dụ: `bsn_lichhen_bot`).
5. `@BotFather` sẽ trả về mã **HTTP API Token** có dạng:
   ```text
   7123456789:AAH_xyz1234567890abcdefghijklmnop
   ```
   👉 Đây chính là **`TELEGRAM_BOT_TOKEN`**.

### Bước 2: Lấy `TELEGRAM_CHAT_ID` của Nhóm Telesale (hoặc cá nhân)
1. Tạo một nhóm Telegram (ví dụ: **`Lịch Hẹn Khách BSN`**) và **thêm con Bot vừa tạo vào nhóm**.
2. Trong nhóm đó, gõ một tin nhắn bất kỳ (ví dụ: `/start` hoặc `hello`).
3. Mở trình duyệt web và truy cập đường dẫn sau (thay `<TOKEN_CUA_BAN>` bằng mã Token ở Bước 1):
   ```text
   https://api.telegram.org/bot<TOKEN_CUA_BAN>/getUpdates
   ```
4. Trong kết quả hiển thị trên trình duyệt, tìm đoạn `"chat":{"id":-1001234567890,...}` hoặc `"chat":{"id":-987654321,...}`:
   - Nếu là **Nhóm (Group / Supergroup)**: `id` sẽ có **dấu trừ `-` ở đầu** (ví dụ: `-100192837465` hoặc `-412345678`). **Nhớ copy cả dấu trừ `-`!**
   - Nếu là **Chat cá nhân**: `id` là một dãy số dương (ví dụ: `123456789`).
   👉 Đây chính là **`TELEGRAM_CHAT_ID`**.

### Bước 3: Điền Token & Chat ID vào hệ thống
Bạn điền vào **2 nơi** sau để vừa tự động báo lịch mỗi sáng, vừa bấm gửi từ Web CRM được:

1. **Trên Google Apps Script (`Mã.gs`)** — mở dòng `32–33` ở đầu file `Mã.gs` và điền:
   ```javascript
   var TELEGRAM_BOT_TOKEN = '7123456789:AAH_xyz1234567890abcdefghijklmnop';
   var TELEGRAM_CHAT_ID = '-100192837465';
   ```
   Nhấn **`Ctrl + S`** để lưu lại.

2. **Trong file `.env` của Web CRM** — điền thêm:
   ```env
   TELEGRAM_BOT_TOKEN=7123456789:AAH_xyz1234567890abcdefghijklmnop
   TELEGRAM_CHAT_ID=-100192837465
   ```

### Bước 4: Bật Hẹn Giờ Tự Động 08:00 Sáng Hàng Ngày
1. Trong cửa sổ **Apps Script**, nhìn lên thanh công cụ phía trên (cạnh nút **Chạy / Run**), chọn hàm **`setupDailyTelegramTrigger`** trong danh sách thả xuống.
2. Bấm nút **Chạy (Run)**.
3. Hoặc đơn giản hơn: Tải lại trang Google Sheet **DATA - BSN**, bạn sẽ thấy một menu mới tên là **`🤖 CRM & Telegram BSN`** trên thanh công cụ:
   - Bấm **`🤖 CRM & Telegram BSN`** ➔ **`📲 Gửi lịch hẹn HÔM NAY vào Telegram`** để test gửi ngay lập tức!
   - Bấm **`🤖 CRM & Telegram BSN`** ➔ **`⏰ Bật tự động gửi Telegram 8h00 sáng hàng ngày`** để kích hoạt chạy tự động mỗi sáng.

### Mẫu tin nhắn Bot gửi vào Telegram mỗi sáng:
```text
📅 LỊCH HẸN KHÁCH HÀNG — HÔM NAY (15/10/2026)
Trạm Chữa Da BSN • Tổng: 3 khách (2 khách cần gọi nhắc)
━━━━━━━━━━━━━━━━━━━━
1. ⏰ 09:30 — Nguyễn Thị Mai
   📞 SĐT: 0987654321
   💆 Dịch vụ: Trị mụn chuẩn y khoa
   📌 Tình trạng: ĐẶT HẸN 🔴 (Cần gọi nhắc)
   👩‍💼 Telesale: THỊNH
   ℹ️ TT Khách: Da dầu mụn viêm 2 má
   📝 Ghi chú: Khách hẹn đi cùng bạn lúc 9h30
```
