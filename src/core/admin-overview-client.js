/**
 * Module này đã được chuyển hoàn toàn về tầng Backend (/api/admin/overview)
 * nhằm bảo mật tuyệt đối dữ liệu Doanh thu (Cột W) và Chi phí Marketing (chỉ Admin mới được phép truy cập qua API).
 */
export async function buildClientAdminOverview() {
  throw new Error('Dữ liệu Tổng quan & Doanh số chỉ được truy xuất qua API bảo mật dành cho Admin.');
}
