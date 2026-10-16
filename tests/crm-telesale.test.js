import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone,
  classifyStatus,
  parseSheetRecords,
} from '../server/sheets-parser.js';
import { DEFAULT_TELESALE_LIST, SHEETS_CONFIG } from '../server/config.js';

test('normalizePhone chuẩn hóa số điện thoại mất số 0 đầu trên Google Sheet', () => {
  assert.equal(normalizePhone('979527930'), '0979527930');
  assert.equal(normalizePhone('09386 20312'), '0938620312');
  assert.equal(normalizePhone('84912345678'), '0912345678');
  assert.equal(normalizePhone('0084912345678'), '0912345678');
  assert.equal(normalizePhone(''), '');
});

test('classifyStatus phân loại chính xác các trạng thái Cột I cho Telesale', () => {
  assert.equal(classifyStatus('').statusGroup, 'new');
  assert.equal(classifyStatus('Đặt Hẹn').statusGroup, 'booked');
  assert.equal(classifyStatus('ĐẶT HẸN').canonicalStatus, 'ĐẶT HẸN');
  assert.equal(classifyStatus('DỜI LỊCH').statusGroup, 'booked');
  assert.equal(classifyStatus('Không Nghe Máy').statusGroup, 'unreachable');
  assert.equal(classifyStatus('Thuê Bao').statusGroup, 'unreachable');
  assert.equal(classifyStatus('Hẹn Gọi Lại').statusGroup, 'followup');
  assert.equal(classifyStatus('Nhu Cầu').statusGroup, 'followup');
  assert.equal(classifyStatus('ĐÃ ĐẾN').statusGroup, 'arrived');
  assert.equal(classifyStatus('Từ Chối').statusGroup, 'lost');
});

test('parseSheetRecords ẩn hoàn toàn doanh số (Cột W) và link FB/Sheet để bảo mật khi public cho nhân sự', () => {
  const sampleCsv = [
    'STT,NGÀY DATA,TÊN KHÁCH HÀNG,SỐ ĐIỆN THOẠI,DỊCH VỤ,NGUỒN,LINK FB,THÔNG TIN KH,TÌNH TRẠNG,GIỜ HẸN,NGÀY HẸN,TELESALE,NOTE M,CARE N,,,,,,,,THỨ,DOANH SỐ',
    '1,03/10/2026,Nguyễn Ngoan,766940905,Mũi sợi 2tr999,Ads FB Mess,https://facebook.com/post,"Chị Ngoan 1977, An Giang",ĐÃ ĐẾN,16h,06/10/2026,THỊNH,Đã tư vấn kỹ,5/10 nhắc lịch,,,,,,,,Thứ 2,13.000.000 ₫',
  ].join('\n');

  const parsed = parseSheetRecords(sampleCsv, 'arrived', DEFAULT_TELESALE_LIST);
  assert.equal(parsed.records.length, 1);

  const rec = parsed.records[0];
  assert.equal(rec.name, 'Nguyễn Ngoan');
  assert.equal(rec.phone, '0766940905');
  assert.equal(rec.telesale, 'THỊNH');
  assert.equal(rec.noteM, 'Đã tư vấn kỹ');
  assert.equal(rec.revenue, undefined);
  assert.equal(rec.revenueAmount, undefined);
  assert.equal(rec.fbLink, undefined);
  assert.equal(
    rec.careHistory.some((c) => c.text.includes('13.000.000') || c.text.includes('₫')),
    false
  );
});

test('Cấu hình mặc định có đủ 3 Sheet và danh sách 5 nhân sự Telesale', () => {
  assert.equal(DEFAULT_TELESALE_LIST.length, 5);
  assert.equal(SHEETS_CONFIG.mkt.gid, '915093349');
  assert.equal(SHEETS_CONFIG.booked.gid, '2007161241');
  assert.equal(SHEETS_CONFIG.arrived.gid, '1566321838');
});

test('getAllSheetsData không để lộ docs.google.com, spreadsheet ID, revenue, hoặc ký hiệu ₫', async () => {
  const { getAllSheetsData } = await import('../server/google-sheets.js');
  const { SPREADSHEET_ID } = await import('../server/config.js');
  const data = await getAllSheetsData(false);
  const jsonStr = JSON.stringify(data);
  assert.equal(jsonStr.includes('docs.google.com'), false);
  assert.equal(jsonStr.includes(SPREADSHEET_ID), false);
  assert.equal(jsonStr.includes('revenue'), false);
  assert.equal(jsonStr.includes('₫'), false);
});

test('renderCard hiển thị đúng thông tin và đầy đủ các controls trực tiếp cho Mobile iPhone', async () => {
  const { renderCard } = await import('../src/main.js');
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');

  const rec = {
    id: 'mkt-row-10',
    sheetKey: 'mkt',
    sheetRowIndex: 10,
    dataDate: '15/10/2026',
    name: 'Trần Thị Mai',
    phone: '0912345678',
    phoneDisplay: '0912 345 678',
    service: 'Mũi sợi 2tr999',
    customerInfo: 'Chị Mai 1985, TP.HCM',
    status: 'ĐẶT HẸN',
    canonicalStatus: 'ĐẶT HẸN',
    statusGroup: 'booked',
    badgeColor: 'emerald',
    apptTime: '10h',
    apptDate: '16/10/2026',
    telesale: 'THỊNH',
    noteM: 'Khách hẹn sáng mai ghé',
    careHistory: [{ text: 'Đã tư vấn qua Zalo' }],
  };

  const cardHtml = renderCard(rec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST);

  // 1-Tap Call & Zalo links
  assert.equal(cardHtml.includes('href="tel:0912345678"'), true);
  assert.equal(cardHtml.includes('href="https://zalo.me/0912345678"'), true);
  assert.equal(cardHtml.includes('data-copy="0912345678"'), true);

  // Direct controls: Status (Col I), Date Picker & Time (Col K, J), Telesale (Col L), Note (Col M)
  assert.equal(cardHtml.includes('data-status-select="mkt-row-10"'), true);
  assert.equal(cardHtml.includes('type="date"'), true);
  assert.equal(cardHtml.includes('data-date-picker="mkt-row-10"'), true);
  assert.equal(cardHtml.includes('value="2026-10-16"'), true);
  assert.equal(cardHtml.includes('data-time-input="mkt-row-10"'), true);
  assert.equal(cardHtml.includes('data-telesale-select="mkt-row-10"'), true);
  assert.equal(cardHtml.includes('data-note-input="mkt-row-10"'), true);

  // Customer information
  assert.equal(cardHtml.includes('Trần Thị Mai'), true);
  assert.equal(cardHtml.includes('15/10/2026'), true);
  assert.equal(cardHtml.includes('Mũi sợi 2tr999'), true);
  assert.equal(cardHtml.includes('Chị Mai 1985, TP.HCM'), true);
  assert.equal(cardHtml.includes('Khách hẹn sáng mai ghé'), true);

  // Privacy: No revenue, google docs links, or ₫
  assert.equal(cardHtml.includes('docs.google.com'), false);
  assert.equal(cardHtml.includes('revenue'), false);
  assert.equal(cardHtml.includes('₫'), false);
});

test('renderCard và renderRow chuẩn hóa số điện thoại có dấu cách và chống crash khi options rỗng', async () => {
  const { renderCard, renderRow } = await import('../src/main.js');

  const recWithSpaces = {
    id: 'mkt-row-99',
    sheetKey: 'mkt',
    sheetRowIndex: 99,
    dataDate: '20/10/2026',
    name: 'Lê Văn An',
    phone: '',
    rawPhone: '0903 888 999',
    phoneDisplay: '0903 888 999',
    service: 'Nâng cơ 999k',
    customerInfo: 'Anh An 1980',
    status: '',
    canonicalStatus: '',
    statusGroup: 'new',
    badgeColor: 'amber',
    apptTime: '',
    apptDate: '',
    telesale: '',
    noteM: '',
    careHistory: [],
  };

  // Check renderCard with rawPhone containing spaces and null/empty options
  const cardHtml = renderCard(recWithSpaces, null, null);
  assert.equal(cardHtml.includes('href="tel:0903888999"'), true);
  assert.equal(cardHtml.includes('href="https://zalo.me/0903888999"'), true);
  assert.equal(cardHtml.includes('data-copy="0903888999"'), true);
  assert.equal(cardHtml.includes('Chưa phân bổ'), true);
  assert.equal(cardHtml.includes('is-new-lead'), true);

  // Check renderRow with same record
  const rowHtml = renderRow(recWithSpaces, null, null);
  assert.equal(rowHtml.includes('href="tel:0903888999"'), true);
  assert.equal(rowHtml.includes('href="https://zalo.me/0903888999"'), true);
  assert.equal(rowHtml.includes('data-copy="0903888999"'), true);
});

test('renderCard và renderRow xử lý an toàn lead không có SĐT hoặc SĐT không hợp lệ', async () => {
  const { renderCard, renderRow } = await import('../src/main.js');

  const recNoPhone = {
    id: 'mkt-row-101',
    sheetKey: 'mkt',
    sheetRowIndex: 101,
    dataDate: '21/10/2026',
    name: 'Hoàng Minh',
    phone: '',
    rawPhone: 'Chưa có số',
    phoneDisplay: 'Chưa có số',
    service: 'Trị mụn BSN',
    customerInfo: '',
    status: '',
    canonicalStatus: '',
    statusGroup: 'new',
    badgeColor: 'amber',
    apptTime: '',
    apptDate: '',
    telesale: '',
    noteM: '',
    careHistory: [],
  };

  const cardHtml = renderCard(recNoPhone, [], []);
  // Should NOT render broken tel: or zalo.me with non-phone strings
  assert.equal(cardHtml.includes('href="tel:Chưa có số"'), false);
  assert.equal(cardHtml.includes('https://zalo.me/Chưa có số'), false);
  assert.equal(cardHtml.includes('href="tel:"'), false);
  // Should render disabled action buttons
  assert.equal(cardHtml.includes('mobile-action-btn mobile-call-btn is-disabled'), true);
  assert.equal(cardHtml.includes('mobile-action-btn mobile-zalo-btn is-disabled'), true);
  assert.equal(cardHtml.includes('disabled'), true);

  const rowHtml = renderRow(recNoPhone, [], []);
  assert.equal(rowHtml.includes('href="tel:Chưa có số"'), false);
  assert.equal(rowHtml.includes('https://zalo.me/Chưa có số'), false);
  assert.equal(rowHtml.includes('Chưa có số'), true);

  const recNoName = { ...recNoPhone, name: '' };
  const cardNoName = renderCard(recNoName, [], []);
  assert.equal(cardNoName.includes('Khách chưa rõ tên'), true);
  const rowNoName = renderRow(recNoName, [], []);
  assert.equal(rowNoName.includes('Khách chưa rõ tên'), true);
});

test('vnDateToIso và isoToVnDate chuẩn hóa chính xác định dạng ngày DD/MM/YYYY lẫn DD/MM', async () => {
  const { vnDateToIso, isoToVnDate } = await import('../src/core/utils.js');
  const currentYear = new Date().getFullYear();

  assert.equal(vnDateToIso('16/10/2026'), '2026-10-16');
  assert.equal(vnDateToIso('16/10/26'), '2026-10-16');
  assert.equal(vnDateToIso('05-09-2026'), '2026-09-05');
  assert.equal(vnDateToIso('05-09-26'), '2026-09-05');
  assert.equal(vnDateToIso('2026-10-16'), '2026-10-16');
  assert.equal(vnDateToIso('16/10'), `${currentYear}-10-16`);
  assert.equal(vnDateToIso(''), '');

  assert.equal(isoToVnDate('2026-10-16'), '16/10/2026');
  assert.equal(isoToVnDate('2026-10-16T14:30:00'), '16/10/2026');
  assert.equal(isoToVnDate(''), '');
});

test('renderCard hiển thị đúng các định dạng giờ hẹn và an toàn với tên/ghi chú cực dài', async () => {
  const { renderCard } = await import('../src/main.js');
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');

  const longRec = {
    id: 'mkt-row-200',
    sheetKey: 'mkt',
    sheetRowIndex: 200,
    dataDate: '22/10/2026',
    name: 'Nguyễn Thị Phương Thảo Vy Huyền Trang Trần Lê',
    phone: '0987654321',
    phoneDisplay: '0987 654 321',
    service: 'Combo Căng chỉ Collagen + Nâng cơ Hifu + Tiêm Meso căng bóng phục hồi đa tầng trẻ hoá da chuyên sâu',
    customerInfo: 'Chị Thảo 1982, chung cư Saigon Pearl 92 Nguyễn Hữu Cảnh P22 Bình Thạnh TP.HCM',
    status: 'ĐẶT HẸN',
    canonicalStatus: 'ĐẶT HẸN',
    statusGroup: 'booked',
    badgeColor: 'emerald',
    apptTime: '14:00',
    apptDate: '25/10/2026',
    telesale: 'PHÚ',
    noteM: 'Khách hẹn đúng 14h chiều qua làm dịch vụ cùng bạn gái, đã dặn chuẩn bị phòng VIP và hỗ trợ book Grab',
    careHistory: [
      { text: '10/10: Nhắc lịch hẹn qua Zalo lúc 9h30 sáng' },
      { text: '12/10: Khách xin dời lịch hẹn từ 2pm sang 14:00 ngày 25/10' },
    ],
  };

  const cardHtml = renderCard(longRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST);
  assert.equal(cardHtml.includes('value="14:00"'), true);
  assert.equal(cardHtml.includes('value="2026-10-25"'), true);
  assert.equal(cardHtml.includes('Nguyễn Thị Phương Thảo'), true);
  assert.equal(cardHtml.includes('href="tel:0987654321"'), true);
  assert.equal(cardHtml.includes('https://zalo.me/0987654321'), true);
  assert.equal(cardHtml.includes('PHÚ'), true);
  assert.equal(cardHtml.includes('docs.google.com'), false);
  assert.equal(cardHtml.includes('revenue'), false);
  assert.equal(cardHtml.includes('₫'), false);
});

test('Mẫu 3 HubSpot Split Calling Cockpit (renderQueueItem & renderCockpitDetail) hiển thị đầy đủ nút 1 chạm và bảo mật dữ liệu', async () => {
  const { renderQueueItem, renderCockpitDetail } = await import('../src/main.js');
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');

  const rec = {
    id: 'mkt-row-15',
    sheetKey: 'mkt',
    sheetRowIndex: 15,
    dataDate: '18/10/2026',
    name: 'Phạm Thanh Hằng',
    phone: '0909123456',
    phoneDisplay: '0909 123 456',
    service: 'Trẻ hoá da chuyên sâu',
    customerInfo: 'Chị Hằng 1988, Quận 3',
    status: 'HẸN GỌI LẠI',
    canonicalStatus: 'HẸN GỌI LẠI',
    statusGroup: 'followup',
    badgeColor: 'blue',
    apptTime: '15h',
    apptDate: '20/10/2026',
    telesale: 'NGÂN',
    noteM: 'Khách hẹn chiều gọi lại tư vấn kỹ hơn',
    careHistory: [{ text: '18/10: Đã gửi hình ảnh feedback qua Zalo' }],
  };

  const queueHtml = renderQueueItem(rec, true, 1);
  assert.equal(queueHtml.includes('queue-item active'), true);
  assert.equal(queueHtml.includes('data-select-record="mkt-row-15"'), true);
  assert.equal(queueHtml.includes('Phạm Thanh Hằng'), true);
  assert.equal(queueHtml.includes('NGÂN'), true);
  assert.equal(queueHtml.includes('docs.google.com'), false);
  assert.equal(queueHtml.includes('₫'), false);

  const cockpitHtml = renderCockpitDetail(rec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, [rec]);
  assert.equal(cockpitHtml.includes('href="tel:0909123456"'), true);
  assert.equal(cockpitHtml.includes('href="https://zalo.me/0909123456"'), true);
  assert.equal(cockpitHtml.includes('data-cockpit-status="ĐẶT HẸN"'), true);
  assert.equal(cockpitHtml.includes('data-cockpit-telesale="NGÂN"'), true);
  assert.equal(cockpitHtml.includes('data-date-picker="mkt-row-15"'), true);
  assert.equal(cockpitHtml.includes('value="2026-10-20"'), true);
  assert.equal(cockpitHtml.includes('data-quick-time="15h"'), true);
  assert.equal(cockpitHtml.includes('data-cockpit-notem="mkt-row-15"'), true);
  assert.equal(cockpitHtml.includes('data-custinfo-input="mkt-row-15"'), true);
  assert.equal(cockpitHtml.includes('docs.google.com'), false);
  assert.equal(cockpitHtml.includes('₫'), false);
});

test('Hệ thống Đăng nhập & Phân quyền Admin / Telesale hoạt động chính xác', async () => {
  const {
    authenticateUser,
    verifyAuthToken,
    listUsersForAdmin,
    createUser,
    updateUser,
    deleteUser,
    getActiveTelesaleNames,
    filterCrmDataForUser,
  } = await import('../server/auth.js');
  const { renderLoginScreen, renderAdminView } = await import('../src/main.js');

  // 1. Màn hình đăng nhập render đầy đủ form User/Pass
  const loginHtml = renderLoginScreen({ loginError: 'Sai mật khẩu' });
  assert.equal(loginHtml.includes('id="login-username"'), true);
  assert.equal(loginHtml.includes('id="login-password"'), true);
  assert.equal(loginHtml.includes('Sai mật khẩu'), true);

  // 2. Đăng nhập tài khoản Admin mặc định
  const adminAuth = authenticateUser('admin', 'bsn@2026');
  assert.equal(adminAuth.ok, true);
  assert.equal(adminAuth.user.role, 'admin');

  const verifiedAdmin = verifyAuthToken(adminAuth.token);
  assert.equal(verifiedAdmin.role, 'admin');

  // 3. Admin tạo tài khoản Telesale mới (User, Pass, Tên Telesale, Quyền)
  const testUsername = `sale_test_${Date.now()}`;
  const createdSale = createUser({
    username: testUsername,
    password: 'pass789',
    telesaleName: 'NGỌC ANH',
    role: 'telesale',
    active: true,
    permissions: {
      accessCrm: true,
      canEdit: true,
      dataScope: 'own_and_unassigned',
    },
  });

  assert.equal(createdSale.username, testUsername);
  assert.equal(createdSale.telesaleName, 'NGỌC ANH');
  assert.equal(createdSale.role, 'telesale');
  assert.equal(getActiveTelesaleNames().includes('NGỌC ANH'), true);

  // 4. Đăng nhập bằng tài khoản Telesale vừa được Admin cấp
  const saleAuth = authenticateUser(testUsername, 'pass789');
  assert.equal(saleAuth.ok, true);
  assert.equal(saleAuth.user.role, 'telesale');
  assert.equal(saleAuth.user.telesaleName, 'NGỌC ANH');

  // 5. Kiểm tra lọc phạm vi dữ liệu cho Telesale (own_and_unassigned)
  const mockCrmData = {
    sheets: {
      mkt: {
        records: [
          { id: '1', name: 'Khách của Ngọc Anh', telesale: 'NGỌC ANH' },
          { id: '2', name: 'Khách chưa gán', telesale: '' },
          { id: '3', name: 'Khách của Thịnh', telesale: 'THỊNH' },
        ],
      },
    },
  };
  const scoped = filterCrmDataForUser(mockCrmData, saleAuth.user);
  assert.equal(scoped.sheets.mkt.records.length, 2);

  // 6. Giao diện Admin hiển thị đầy đủ danh sách user, pass, tên Telesale
  const adminHtml = renderAdminView(listUsersForAdmin(), null, adminAuth.user.id);
  assert.equal(adminHtml.includes(testUsername), true);
  assert.equal(adminHtml.includes('NGỌC ANH'), true);
  assert.equal(adminHtml.includes('pass789'), true);

  // 7. Khi Admin khóa tài khoản (active: false), token của Telesale bị vô hiệu hóa ngay lập tức
  updateUser(createdSale.id, { active: false });
  assert.equal(verifyAuthToken(saleAuth.token), null);

  // Dọn dẹp tài khoản test
  deleteUser(createdSale.id, adminAuth.user.id);
});

test('Airtable Sales CRM Kanban Pipeline (renderKanbanBoard) phân cột chính xác theo Stage', async () => {
  const { renderKanbanBoard } = await import('../src/main.js');
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');

  const sampleRecords = [
    {
      id: 'mkt-row-101',
      name: 'Lê Thu Trang',
      phone: '0911222333',
      status: 'ĐẶT HẸN',
      canonicalStatus: 'ĐẶT HẸN',
      statusGroup: 'booked',
      badgeColor: 'emerald',
      apptDate: '20/10/2026',
      apptTime: '09:30',
      telesale: 'THỊNH',
      noteM: 'Khách hẹn qua sáng',
    },
  ];

  const html = renderKanbanBoard(sampleRecords, STATUS_OPTIONS, DEFAULT_TELESALE_LIST);
  assert.equal(html.includes('airtable-kanban-wrap'), true);
  assert.equal(html.includes('Đặt Hẹn / Dời Lịch'), true);
  assert.equal(html.includes('Lê Thu Trang'), true);
  assert.equal(html.includes('docs.google.com'), false);
  assert.equal(html.includes('₫'), false);
});

test('Tích hợp Không gian điều hành CEO (crm-tram-chua-da) dành riêng cho Admin', async () => {
  const { getAdminOverviewData, parseVnNumber, resolveOverviewPeriod, parseMarketingRows } =
    await import('../server/admin-overview.js');
  const { renderAdminOverview } = await import('../src/main.js');

  assert.equal(parseVnNumber('13.000.000 ₫'), 13000000);
  assert.equal(parseVnNumber('1.527.345 đ'), 1527345);
  assert.equal(parseVnNumber('-1.500.000 đ'), -1500000);
  assert.equal(parseVnNumber('24,89%'), 24.89);

  const period = resolveOverviewPeriod({ period: 'all' });
  assert.equal(period.key, 'all');

  const ovData = await getAdminOverviewData({ period: 'all' });
  assert.equal(ovData.ok, true);
  assert.equal(typeof ovData.crm.leads, 'number');
  assert.equal(ovData.crm.leads > 0, true);
  assert.equal(ovData.crm.revenue > 0, true);
  assert.equal(ovData.marketing.cost > 0, true);
  assert.equal(ovData.marketing.received > 0, true);
  assert.equal(Array.isArray(ovData.serviceFunnel), true);
  assert.equal(ovData.serviceFunnel.length, 3);
  assert.equal(Array.isArray(ovData.telesaleLeaderboard), true);

  const html = renderAdminOverview(ovData, { overviewPeriod: 'all' });
  assert.equal(html.includes('Tổng Quan Vận Hành, Doanh Số & Tài Chính Marketing'), true);
  assert.equal(html.includes('DOANH SỐ THỰC THU (CỘT W)'), true);
  assert.equal(html.includes('TỔNG CHI PHÍ MARKETING'), true);
  assert.equal(html.includes('SỐ TIỀN CÒN LẠI (SỐ DƯ CỘT B)'), true);
  assert.equal(html.includes('Phễu Chuyển Đổi Theo Hạng Mục Dịch Vụ'), true);
  assert.equal(html.includes('Hiệu Suất & Doanh Số Theo Nhân Sự Telesale'), true);

  // Kiểm tra trường hợp Số tiền còn lại bị ÂM (balance < 0) -> hiển thị cảnh báo đỏ & số tiền cần nạp bù ngay
  const negHtml = renderAdminOverview(
    {
      ...ovData,
      marketing: {
        ...ovData.marketing,
        received: 20000000,
        adsCost: 20500000,
        managementFee: 1025000,
        cost: 21525000,
        balance: -1525000,
        topUpNeeded: 1525000,
        recommendedTopUp7Days: 12000000,
      },
    },
    { overviewPeriod: 'month' }
  );
  assert.equal(negHtml.includes('is-balance-negative'), true);
  assert.equal(negHtml.includes('-1.525.000 VNĐ'), true);
  assert.equal(negHtml.includes('Đang âm quỹ! Cần nạp bù ngay:'), true);
  assert.equal(negHtml.includes('1.525.000 VNĐ'), true);

  // Kiểm tra parseMarketingRows với dòng tổng kết THÁNG 10 (22.100.286 đ)
  const parsedSample = parseMarketingRows([
    ['THÁNG 10', '579.291 đ', '23.784.591 đ', '22.100.286 đ', '1.105.014 đ', '23.205.300 đ'],
    ['01/10/2026', '', '23.784.591 đ', '22.100.286 đ', '1.105.014 đ', '23.205.300 đ'],
  ]);
  assert.equal(parsedSample.monthlySummaries['2026-10'].ads, 22100286);
  assert.equal(parsedSample.monthlySummaries['2026-10'].balance, 579291);

  // Kiểm tra số liệu Tháng 10/2026 đồng bộ trực tiếp từ Sheet 2026 (gid=1227076939)
  const octData = await getAdminOverviewData({
    period: 'custom',
    from: '2026-10-01',
    to: '2026-10-31',
  });
  assert.equal(Math.round(octData.marketing.adsCost) >= 22100286, true);
  assert.equal(Math.round(octData.marketing.received) >= 23784591, true);
  assert.equal(
    Math.round(octData.marketing.balance),
    Math.round(octData.marketing.received - octData.marketing.cost)
  );
});

test('analyzeContactLogs & Timeline Ghi chú bóc tách chính xác số lần liên hệ, số cuộc gọi và ngày giờ từng lần', async () => {
  const { analyzeContactLogs, ensureNoteTimestampPrefix, renderRow, renderCard } = await import(
    '../src/main.js'
  );
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');

  const sampleRec = {
    id: 'mkt-row-832',
    sheetKey: 'mkt',
    sheetRowIndex: 832,
    dataDate: '14/10/2026',
    name: 'Nguyet Anh',
    phone: '0912345678',
    statusGroup: 'unreachable',
    noteM: '19h55 2c tb, đã kbzl',
    careHistory: [
      { text: '15/10 8h33 2c zl knm, đã nt care' },
      { text: '10h15 2c zl knm, 12h04 2c knm' },
    ],
  };

  const log = analyzeContactLogs(sampleRec);
  assert.equal(log.totalContacts, 3);
  assert.equal(log.totalCallAttempts, 8);
  assert.equal(log.entries[0].dateShort, '14/10');
  assert.equal(log.entries[0].timeLabel, '19h55');
  assert.equal(log.entries[1].dateShort, '15/10');
  assert.equal(log.entries[1].timeLabel, '8h33');
  assert.equal(log.entries[2].dateShort, '15/10');
  assert.equal(log.entries[2].timeLabel, '10h15 → 12h04');
  assert.equal(log.latestSummary, '15/10 · 12h04');

  const fixedDate = new Date(2026, 9, 15, 13, 30);
  assert.equal(ensureNoteTimestampPrefix('2c knm', fixedDate), '15/10 13h30 2c knm');
  assert.equal(ensureNoteTimestampPrefix('9h15 khách bận', fixedDate), '15/10 9h15 khách bận');
  assert.equal(ensureNoteTimestampPrefix('15/10 9h15 khách bận', fixedDate), '15/10 9h15 khách bận');

  const rowHtml = renderRow(sampleRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST);
  assert.equal(rowHtml.includes('Đã LH <strong>3 lần</strong>'), true);
  assert.equal(rowHtml.includes('(8 cuộc)'), true);
  assert.equal(rowHtml.includes('Lần 1'), true);
  assert.equal(rowHtml.includes('Lần 2'), true);
  assert.equal(rowHtml.includes('Lần 3'), true);
  assert.equal(rowHtml.includes('<span>Thêm ghi chú</span>'), true);
  assert.equal(rowHtml.includes('+ Ghi Lần'), false);

  const cardHtml = renderCard(sampleRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST);
  assert.equal(cardHtml.includes('Đã LH <strong>3 lần</strong>'), true);
  assert.equal(cardHtml.includes('Lần 2'), true);
  assert.equal(cardHtml.includes('Lần 3'), true);
});

test('Admin có toàn quyền chỉnh sửa & xóa mọi ghi chú (Lần 1 và Lịch sử Care Lần 2+)', async () => {
  const { renderNoteTimelineBlock } = await import('../src/main.js');

  const sampleRec = {
    id: 'mkt-row-832',
    sheetKey: 'mkt',
    sheetRowIndex: 832,
    dataDate: '14/10/2026',
    name: 'Nguyet Anh',
    phone: '0912345678',
    noteM: '14/10 19h55 2c tb, đã kbzl',
    careHistory: [
      { text: '15/10 8h33 2c zl knm, đã nt care' },
      { text: '15/10 10h15 ghi nhầm khách cần xóa' },
    ],
  };

  // Khi render cho Admin (isAdmin: true):
  // - Đã bỏ các nút Lưu & Xóa rườm rà ở từng dòng ghi chú
  // - Vẫn có ô input sửa trực tiếp (data-care-edit-input) cho Lần 2, Lần 3...
  const adminHtml = renderNoteTimelineBlock(sampleRec, false, { isAdmin: true });
  assert.equal(adminHtml.includes('🛡️ Admin Sửa/Xóa'), false);
  assert.equal(adminHtml.includes('data-admin-save-notem="mkt-row-832"'), false);
  assert.equal(adminHtml.includes('data-admin-delete-notem="mkt-row-832"'), false);
  assert.equal(adminHtml.includes('data-care-edit-input="mkt-row-832"'), true);
  assert.equal(adminHtml.includes('data-care-save="mkt-row-832"'), false);
  assert.equal(adminHtml.includes('data-care-delete="mkt-row-832"'), false);

  // Khi render cho Telesale (isAdmin: false): không hiện ô sửa lịch sử Care
  const saleHtml = renderNoteTimelineBlock(sampleRec, false, { isAdmin: false });
  assert.equal(saleHtml.includes('data-care-edit-input='), false);
  assert.equal(saleHtml.includes('data-care-delete='), false);
});

test('Quyền Gửi Telegram chỉ hiển thị cho Admin và ẩn hoàn toàn với User (Telesale)', async () => {
  const { renderRow, renderCard } = await import('../src/main.js');
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');
  const {
    formatSingleCustomerTelegramMessage,
    formatBatchAppointmentsTelegramMessage,
  } = await import('../server/google-sheets.js');

  const sampleRec = {
    id: 'mkt-row-901',
    sheetKey: 'mkt',
    sheetRowIndex: 901,
    dataDate: '15/10/2026',
    name: 'Nguyễn Thị Mai',
    phone: '0987654321',
    phoneDisplay: '0987 654 321',
    service: 'Trị mụn chuẩn y khoa',
    customerInfo: 'Da dầu mụn viêm 2 má',
    status: 'ĐẶT HẸN',
    canonicalStatus: 'ĐẶT HẸN',
    statusGroup: 'booked',
    badgeColor: 'emerald',
    apptTime: '09:30',
    apptDate: '15/10/2026',
    telesale: 'THỊNH',
    noteM: 'Khách hẹn đi cùng bạn lúc 9h30',
    careHistory: [],
  };

  // 1. Khi là User / Telesale (mặc định hoặc isAdmin: false) -> ẨN HOÀN TOÀN nút gửi Telegram
  const userRowHtml = renderRow(sampleRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: false });
  const userCardHtml = renderCard(sampleRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: false });
  assert.equal(userRowHtml.includes('data-send-telegram-customer'), false);
  assert.equal(userCardHtml.includes('data-send-telegram-customer'), false);

  // 2. Khi là Admin (isAdmin: true) -> HIỂN THỊ nút gửi Telegram cho từng khách lẻ
  const adminRowHtml = renderRow(sampleRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: true });
  const adminCardHtml = renderCard(sampleRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: true });
  assert.equal(adminRowHtml.includes('data-send-telegram-customer="mkt-row-901"'), true);
  assert.equal(adminCardHtml.includes('data-send-telegram-customer="mkt-row-901"'), true);

  // 3. Kiểm tra mẫu tin nhắn Telegram cho từng khách lẻ đúng chuẩn form yêu cầu
  const singleMsg = formatSingleCustomerTelegramMessage(sampleRec, '15/10/2026');
  assert.equal(singleMsg.includes('📅 <b>LỊCH HẸN KHÁCH HÀNG — (15/10/2026)</b>'), true);
  assert.equal(singleMsg.includes('1. ⏰ <b>09:30</b> — <b>Nguyễn Thị Mai</b>'), true);
  assert.equal(singleMsg.includes('📞 SĐT: <code>0987654321</code>'), true);
  assert.equal(singleMsg.includes('💆 Dịch vụ: Trị mụn chuẩn y khoa'), true);
  assert.equal(singleMsg.includes('📌 Tình trạng: ĐẶT HẸN 🔴 (Cần gọi nhắc)'), true);
  assert.equal(singleMsg.includes('👩‍💼 Telesale: <b>THỊNH</b>'), true);
  assert.equal(singleMsg.includes('ℹ️ TT Khách: Da dầu mụn viêm 2 má'), true);
  assert.equal(singleMsg.includes('📝 Ghi chú: Khách hẹn đi cùng bạn lúc 9h30'), true);

  // 4. Kiểm tra mẫu tin nhắn Telegram tự động gửi danh sách lịch hẹn 8h sáng
  const batchMsg = formatBatchAppointmentsTelegramMessage([sampleRec], '15/10/2026', 'HÔM NAY');
  assert.equal(batchMsg.includes('📅 <b>LỊCH HẸN KHÁCH HÀNG — HÔM NAY (15/10/2026)</b>'), true);
  assert.equal(batchMsg.includes('Tổng cộng: <b>1 khách hẹn</b>'), true);
  assert.equal(batchMsg.includes('1. ⏰ <b>09:30</b> — <b>Nguyễn Thị Mai</b>'), true);

  // 5. Kiểm tra phần Quản trị Tự động báo lịch qua Telegram trong trang Admin (Bật/Tắt & Cài đặt giờ gửi)
  const { renderAdminView } = await import('../src/main.js');
  const { getTelegramScheduleConfig, updateTelegramScheduleConfig } = await import(
    '../server/google-sheets.js'
  );

  const adminPanelOnHtml = renderAdminView([], null, 'admin-1', {
    enabled: true,
    sendTime: '08:30',
    lastSentDate: '15/10/2026',
    lastSentTime: '08:30',
  });
  assert.equal(adminPanelOnHtml.includes('Quản Trị Tự Động Báo Lịch Hẹn Qua Telegram'), true);
  assert.equal(adminPanelOnHtml.includes('id="btn-toggle-tele-auto"'), true);
  assert.equal(adminPanelOnHtml.includes('id="admin-tele-send-time"'), true);
  assert.equal(adminPanelOnHtml.includes('value="08:30"'), true);
  assert.equal(adminPanelOnHtml.includes('Đang BẬT · Tự động gửi lúc 08:30 mỗi ngày'), true);

  const adminPanelOffHtml = renderAdminView([], null, 'admin-1', {
    enabled: false,
    sendTime: '09:00',
  });
  assert.equal(adminPanelOffHtml.includes('Đang TẮT tự động gửi lịch hẹn'), true);

  // Kiểm tra hàm lưu cấu hình Bật/Tắt và Giờ gửi trên Backend
  const prevCfg = getTelegramScheduleConfig();
  const updatedCfg = await updateTelegramScheduleConfig({ enabled: false, sendTime: '09:15' });
  assert.equal(updatedCfg.enabled, false);
  assert.equal(updatedCfg.sendTime, '09:15');
  // Khôi phục lại mặc định 08:00 Bật
  await updateTelegramScheduleConfig({
    enabled: prevCfg.enabled,
    sendTime: prevCfg.sendTime || '08:00',
  });
});

test('Admin Thêm Data từ Messenger (Cột B..K), Tự động đồng bộ Sheet 2 (Đặt Hẹn) & Sheet 3 (Đã Đến + Doanh số Cột W)', async () => {
  const {
    parseMessengerLeadText,
    renderAddLeadModal,
    renderArrivedRevenueModal,
    renderRow,
    renderCard,
  } = await import('../src/main.js');
  const {
    STATUS_OPTIONS,
    SERVICE_OPTIONS,
    SOURCE_OPTIONS,
    DEFAULT_TELESALE_LIST,
  } = await import('../server/config.js');
  const {
    addAdminLead,
    deleteAdminLead,
    updateCustomerInteraction,
    getAllSheetsData,
    getLocalStateSnapshot,
    parseAdminRevenueInput,
    formatVnRevenueCell,
  } = await import('../server/google-sheets.js');

  // 1. Kiểm tra cấu hình Cột E (Loại dịch vụ) & Cột F (Nguồn)
  assert.deepEqual(SERVICE_OPTIONS, ['Nâng cơ 999k', 'Mũi sợi 1tr999', 'Mũi sợi 2tr999']);
  assert.deepEqual(SOURCE_OPTIONS, ['Ads FB Mess', 'Giới thiệu', 'Gọi điện trực tiếp', 'Google']);

  // 2. Kiểm tra bóc tách nhanh nội dung tư vấn từ Messenger
  const parsedMess = parseMessengerLeadText(
    'Chị Lan Hương 0918273645 tư vấn Mũi sợi 2tr999 https://www.facebook.com/profile.php?id=1000999 mũi chưa từng làm, hẹn mai 10h qua'
  );
  assert.equal(parsedMess.phone, '0918273645');
  assert.equal(parsedMess.service, 'Mũi sợi 2tr999');
  assert.equal(parsedMess.fbLink, 'https://www.facebook.com/profile.php?id=1000999');
  assert.equal(parsedMess.customerInfo.includes('mũi chưa từng làm'), true);

  // 3. Kiểm tra giao diện Modal Thêm Data (Cột B -> Cột K + Khác tự điền)
  const addModalHtml = renderAddLeadModal({
    serviceOptions: SERVICE_OPTIONS,
    sourceOptions: SOURCE_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    telesaleList: DEFAULT_TELESALE_LIST,
  });
  assert.equal(addModalHtml.includes('id="add-lead-datadate"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-name"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-phone"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-service-select"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-service-custom"'), true);
  assert.equal(addModalHtml.includes('Nâng cơ 999k'), true);
  assert.equal(addModalHtml.includes('Mũi sợi 1tr999'), true);
  assert.equal(addModalHtml.includes('Mũi sợi 2tr999'), true);
  assert.equal(addModalHtml.includes('id="add-lead-source-select"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-source-custom"'), true);
  assert.equal(addModalHtml.includes('Ads FB Mess'), true);
  assert.equal(addModalHtml.includes('Giới thiệu'), true);
  assert.equal(addModalHtml.includes('Gọi điện trực tiếp'), true);
  assert.equal(addModalHtml.includes('Google'), true);
  assert.equal(addModalHtml.includes('value="__OTHER__"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-fblink"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-custinfo"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-status"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-apptdate"'), true);
  assert.equal(addModalHtml.includes('id="add-lead-appttime"'), true);
  assert.equal(addModalHtml.includes('Dán nhanh nội dung tư vấn'), false);
  assert.equal(addModalHtml.includes('Quy tắc tự động đồng bộ'), false);
  assert.equal(addModalHtml.includes('Cột B'), false);

  // 4. Kiểm tra phân quyền trạng thái ĐÃ ĐẾN & nút Xóa Data: ẩn với Telesale (isAdmin: false), hiện với Admin (isAdmin: true)
  const dummyRec = {
    id: 'mkt-row-777',
    sheetKey: 'mkt',
    sheetRowIndex: 777,
    dataDate: '15/10/2026',
    name: 'Khách Test Quyền',
    phone: '0901112233',
    status: 'ĐẶT HẸN',
    canonicalStatus: 'ĐẶT HẸN',
    statusGroup: 'booked',
  };
  const saleRow = renderRow(dummyRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: false });
  const saleCard = renderCard(dummyRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: false });
  assert.equal(saleRow.includes('value="ĐÃ ĐẾN"'), false);
  assert.equal(saleCard.includes('value="ĐÃ ĐẾN"'), false);
  assert.equal(saleRow.includes('data-delete-customer'), false);
  assert.equal(saleCard.includes('data-delete-customer'), false);

  const adminRow = renderRow(dummyRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: true });
  const adminCard = renderCard(dummyRec, STATUS_OPTIONS, DEFAULT_TELESALE_LIST, { isAdmin: true });
  assert.equal(adminRow.includes('value="ĐÃ ĐẾN"'), true);
  assert.equal(adminCard.includes('value="ĐÃ ĐẾN"'), true);
  assert.equal(adminRow.includes('admin-date-row-wrap'), true);
  assert.equal(adminRow.includes('data-delete-customer="mkt-row-777"'), true);
  assert.equal(adminCard.includes('data-delete-customer="mkt-row-777"'), true);

  // 5. Kiểm tra Modal nhập doanh số khi Admin chuyển sang ĐÃ ĐẾN
  const arrivedModalHtml = renderArrivedRevenueModal({}, { record: dummyRec, status: 'ĐÃ ĐẾN' });
  assert.equal(arrivedModalHtml.includes('id="arrived-revenue-input"'), true);
  assert.equal(arrivedModalHtml.includes('Doanh số thực thu'), true);

  // 6. Kiểm tra chuẩn hóa tiền doanh số Cột W
  assert.equal(parseAdminRevenueInput('2.999.000'), 2999000);
  assert.equal(parseAdminRevenueInput('1tr999'), 1999000);
  assert.equal(parseAdminRevenueInput('999k'), 999000);
  assert.equal(formatVnRevenueCell(2999000), '2.999.000 ₫');

  // 7. Kiểm tra addAdminLead + tự động thêm sang Sheet 2) KHÁCH ĐẶT HẸN khi có lịch hẹn cụ thể (Cột K)
  const addedRes = await addAdminLead({
    dataDate: '15/10/2026',
    name: 'Chị Thanh Thảo Messenger',
    phone: '0933445566',
    service: 'Mũi sợi 2tr999',
    source: 'Ads FB Mess',
    fbLink: 'https://facebook.com/thanhthao.test',
    customerInfo: 'Tư vấn từ Mess: mũi thấp, muốn làm tự nhiên',
    status: '',
    apptDate: '2026-10-18',
    apptTime: '10:30',
    telesale: 'THỊNH',
    noteM: 'Khách chốt lịch qua Mess',
  });
  assert.equal(addedRes.ok, true);
  assert.equal(addedRes.record.name, 'Chị Thanh Thảo Messenger');
  assert.equal(addedRes.record.phone, '0933445566');
  assert.equal(addedRes.record.service, 'Mũi sợi 2tr999');
  assert.equal(addedRes.record.source, 'Ads FB Mess');
  assert.equal(addedRes.record.customerInfo, 'Tư vấn từ Mess: mũi thấp, muốn làm tự nhiên');
  // Vì có apptDate (Cột K) nên tự động chuyển thành ĐẶT HẸN và đồng bộ sang Sheet 2 (booked)
  assert.equal(addedRes.record.canonicalStatus, 'ĐẶT HẸN');
  assert.equal(addedRes.syncedBooked, true);
  // Bảo mật: không trả về fbLink hay revenue trong public record
  assert.equal(addedRes.record.fbLink, undefined);
  assert.equal(addedRes.record.revenue, undefined);

  // 8. Khi Admin chuyển tình trạng sang ĐÃ ĐẾN kèm doanh số -> đồng bộ sang Sheet 3) KHÁCH ĐÃ ĐẾN & ghi Cột W
  const arrivedRes = await updateCustomerInteraction({
    sheetKey: 'mkt',
    sheetRowIndex: addedRes.record.sheetRowIndex,
    updates: {
      status: 'ĐÃ ĐẾN',
      revenue: '2.999.000',
    },
  });
  assert.equal(arrivedRes.ok, true);

  const snapshot = getLocalStateSnapshot();
  assert.equal(snapshot.revenueByPhone['0933445566'], 2999000);
  const arrivedList = snapshot.addedRecords?.arrived || [];
  assert.equal(
    arrivedList.some((r) => r.phone === '0933445566' && r.revenueAmount === 2999000),
    true
  );

  // Đảm bảo getAllSheetsData vẫn không lộ fbLink, revenue hay ký hiệu ₫ cho Telesale
  const publicData = await getAllSheetsData(false);
  const publicJson = JSON.stringify(publicData);
  assert.equal(publicJson.includes('Chị Thanh Thảo Messenger'), true);
  assert.equal(publicJson.includes('thanhthao.test'), false);
  assert.equal(publicJson.includes('revenue'), false);
  assert.equal(publicJson.includes('₫'), false);

  // 9. Kiểm tra Admin xóa Data khách hàng khỏi CRM (đồng thời xóa khỏi các sheet liên kết)
  const delRes = await deleteAdminLead({
    recordId: addedRes.record.id,
    sheetKey: 'mkt',
    sheetRowIndex: addedRes.record.sheetRowIndex,
    phone: '0933445566',
    name: 'Chị Thanh Thảo Messenger',
  });
  assert.equal(delRes.ok, true);
  assert.equal(delRes.deleted.phone, '0933445566');

  const afterDelData = await getAllSheetsData(false);
  const afterDelJson = JSON.stringify(afterDelData);
  assert.equal(afterDelJson.includes('Chị Thanh Thảo Messenger'), false);
  assert.equal(afterDelJson.includes('0933445566'), false);
});

test('Bảo mật toàn diện: Không lộ token/doanh thu ở frontend, chặn truy cập file nhạy cảm & mã hóa mật khẩu trên đĩa', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT_DIR } = await import('../server/config.js');
  const { listUsersForAdmin } = await import('../server/auth.js');
  const usersFilePath = path.join(ROOT_DIR, 'server', 'data', 'users.json');

  // 1. Kiểm tra các file mã nguồn không chứa Telegram Bot Token lộ thiên
  for (const relFile of ['server/config.js', 'server/google-sheets.js', 'google-apps-script.js']) {
    const content = fs.readFileSync(path.join(ROOT_DIR, relFile), 'utf-8');
    assert.equal(content.includes('AAHXY82ppPUVoFaqYy6xGSrPxQBp'), false, `Không lộ token trong ${relFile}`);
  }

  // 2. Kiểm tra file client public (src/core/admin-overview-client.js) không chứa dữ liệu doanh thu/SĐT khách hàng
  const clientOverviewCode = fs.readFileSync(
    path.join(ROOT_DIR, 'src/core/admin-overview-client.js'),
    'utf-8'
  );
  assert.equal(clientOverviewCode.includes('ARRIVED_REVENUE_BY_PHONE'), false);
  assert.equal(clientOverviewCode.includes('MARKETING_DAILY_ROWS_2026'), false);

  // 3. Kiểm tra users.json trên đĩa đã mã hóa AES-256-GCM trường passwordDisplay (bắt đầu bằng enc:v1:),
  // nhưng Admin gọi listUsersForAdmin() vẫn giải mã được để quản lý
  const adminUsers = listUsersForAdmin();
  assert.equal(adminUsers.length >= 6, true);
  if (fs.existsSync(usersFilePath)) {
    const rawUsersDisk = fs.readFileSync(usersFilePath, 'utf-8');
    assert.equal(rawUsersDisk.includes('bsn@2026'), false, 'Không lưu mật khẩu dạng rõ trên đĩa');
    assert.equal(rawUsersDisk.includes('enc:v1:'), true, 'Mật khẩu hiển thị được mã hóa AES-256-GCM trên đĩa');
  }

  // 4. Kiểm tra Menu điều hướng dưới Footer trên Mobile (4 tab cho Telesale, 6 tab cho Admin)
  const { renderMobileBottomNav } = await import('../src/main.js');
  const saleBottomNav = renderMobileBottomNav(
    'mkt',
    { mkt: 647, booked: 49, arrived: 116, today: 3 },
    false
  );
  assert.equal(saleBottomNav.includes('mobile-bottom-nav has-4-tabs'), true);
  assert.equal(saleBottomNav.includes('data-tab="mkt"'), true);
  assert.equal(saleBottomNav.includes('data-tab="overview"'), false);
  assert.equal(saleBottomNav.includes('data-tab="admin"'), false);

  const adminBottomNav = renderMobileBottomNav(
    'admin',
    { mkt: 647, booked: 49, arrived: 116, today: 3 },
    true
  );
  assert.equal(adminBottomNav.includes('mobile-bottom-nav has-6-tabs'), true);
  assert.equal(adminBottomNav.includes('data-tab="overview"'), true);
  assert.equal(adminBottomNav.includes('data-tab="admin"'), true);

  // 5. Kiểm tra Kanban Pipeline (renderKanbanBoard) gắn class is-kanban-card và tách riêng .card-admin-actions
  const { renderKanbanBoard } = await import('../src/main.js');
  const { STATUS_OPTIONS, DEFAULT_TELESALE_LIST } = await import('../server/config.js');
  const kanbanHtml = renderKanbanBoard(
    [
      {
        id: 'mkt-row-500',
        sheetKey: 'mkt',
        sheetRowIndex: 500,
        dataDate: '15/10/2026',
        name: 'Nguyet Anh',
        phone: '0987098206',
        phoneDisplay: '0987 098 206',
        service: 'Nâng cơ 999k',
        customerInfo: 'Tư vấn nâng cơ trẻ hóa',
        status: 'ĐẶT HẸN',
        canonicalStatus: 'ĐẶT HẸN',
        statusGroup: 'booked',
        badgeColor: 'emerald',
        apptDate: '16/10/2026',
        apptTime: '9h',
        telesale: 'NGÂN',
        noteM: '14/10 19h55 2c tb',
        careHistory: [{ text: '15/10 8h33 đã chốt hẹn' }],
      },
    ],
    STATUS_OPTIONS,
    DEFAULT_TELESALE_LIST,
    { isAdmin: true }
  );
  assert.equal(kanbanHtml.includes('is-kanban-card'), true);
  assert.equal(kanbanHtml.includes('card-admin-actions'), true);
});

test('Nhật ký thao tác hệ thống (Admin Audit Log): Ghi nhận đầy đủ thao tác của Telesale & Admin kèm đối chiếu Trước → Sau và bộ lọc lịch sử', async () => {
  const { recordActivityLog, listActivityLogs } = await import('../server/activity-log.js');
  const { updateCustomerInteraction } = await import('../server/google-sheets.js');
  const { renderAdminView, renderAdminActivityLogSection } = await import('../src/main.js');
  const { listUsersForAdmin } = await import('../server/auth.js');

  // 1. Giả lập Telesale (sale1 - THỊNH) cập nhật tình trạng & thêm ghi chú Care trên dòng khách hàng
  await updateCustomerInteraction({
    sheetKey: 'mkt',
    sheetRowIndex: 12,
    updates: {
      status: 'GỌI LẠI',
      careAppend: 'Khách đang họp, hẹn chiều 15h gọi lại tư vấn',
    },
    actor: {
      id: 'user-sale-1',
      username: 'sale1',
      role: 'telesale',
      telesaleName: 'THỊNH',
    },
  });

  // 2. Giả lập Admin đăng nhập & thao tác quản trị hệ thống
  recordActivityLog({
    actor: {
      id: 'user-admin',
      username: 'admin',
      role: 'admin',
      telesaleName: 'ADMIN',
    },
    actionType: 'auth_login',
    actionLabel: 'Đăng nhập hệ thống',
    target: {
      sheetName: 'Hệ thống CRM',
      customerName: 'ADMIN (@admin)',
    },
    summary: 'Đăng nhập thành công vào CRM với quyền Quản trị viên (Admin)',
    changes: [{ field: 'login', label: 'Phiên đăng nhập', before: '—', after: 'Thành công' }],
  });

  // 3. Kiểm tra listActivityLogs lọc theo tài khoản Telesale, Admin, loại hành động và từ khóa
  const allResult = listActivityLogs({ actor: 'all', actionType: 'all', limit: 100 });
  assert.equal(allResult.logs.length >= 2, true);
  assert.equal(allResult.stats.total >= 2, true);

  const sale1Only = listActivityLogs({ actor: 'sale1', actionType: 'all', limit: 50 });
  assert.equal(sale1Only.logs.length >= 1, true);
  assert.equal(
    sale1Only.logs.some(
      (item) =>
        item.actor.username === 'sale1' &&
        item.actor.role === 'telesale' &&
        item.changes.some((c) => String(c.after).includes('15h gọi lại'))
    ),
    true
  );

  const adminRoleOnly = listActivityLogs({ actor: 'role:admin', actionType: 'system', limit: 50 });
  assert.equal(adminRoleOnly.logs.length >= 1, true);
  assert.equal(
    adminRoleOnly.logs.every((item) => item.actor.role === 'admin'),
    true
  );

  const searchResult = listActivityLogs({ search: '15h gọi lại', limit: 20 });
  assert.equal(searchResult.logs.length >= 1, true);

  // 4. Kiểm tra giao diện Admin render bảng Nhật ký thao tác kèm bộ lọc và chi tiết Trước → Sau
  const users = listUsersForAdmin();
  const auditSectionHtml = renderAdminActivityLogSection(users, {
    logs: allResult.logs.slice(0, 10),
    stats: allResult.stats,
    filters: { actor: 'all', actionType: 'all', search: '' },
    loading: false,
  });

  assert.equal(auditSectionHtml.includes('Nhật Ký Thao Tác & Kiểm Tra Lịch Sử Hệ Thống'), true);
  assert.equal(auditSectionHtml.includes('id="audit-filter-actor"'), true);
  assert.equal(auditSectionHtml.includes('id="audit-filter-type"'), true);
  assert.equal(auditSectionHtml.includes('id="audit-filter-search"'), true);
  assert.equal(auditSectionHtml.includes('15h gọi lại'), true);
  assert.equal(auditSectionHtml.includes('audit-change-item'), true);

  const fullAdminHtml = renderAdminView(users, null, 'user-admin', null, {
    logs: allResult.logs.slice(0, 5),
    stats: allResult.stats,
    filters: { actor: 'all', actionType: 'all', search: '' },
    loading: false,
  });
  assert.equal(fullAdminHtml.includes('id="admin-activity-log-card"'), true);
  assert.equal(fullAdminHtml.includes('id="btn-jump-audit-log"'), true);

  // 5. Kiểm tra thứ tự sắp xếp 4 phần trong trang Quản Trị User:
  // 1) Cấp Tài Khoản Mới & Phân Quyền Vào CRM
  // 2) Danh Sách Tài Khoản & Phân Quyền Nhân Sự
  // 3) 🤖 Quản Trị Tự Động Báo Lịch Hẹn Qua Telegram
  // 4) 📜 Nhật Ký Thao Tác & Kiểm Tra Lịch Sử Hệ Thống
  const idxCreateUser = fullAdminHtml.indexOf('Cấp Tài Khoản Mới & Phân Quyền Vào CRM');
  const idxUserList = fullAdminHtml.indexOf('Danh Sách Tài Khoản & Phân Quyền Nhân Sự');
  const idxTeleSchedule = fullAdminHtml.indexOf('🤖 Quản Trị Tự Động Báo Lịch Hẹn Qua Telegram');
  const idxAuditLog = fullAdminHtml.indexOf('📜 Nhật Ký Thao Tác & Kiểm Tra Lịch Sử Hệ Thống');
  assert.equal(idxCreateUser > 0 && idxCreateUser < idxUserList, true);
  assert.equal(idxUserList < idxTeleSchedule, true);
  assert.equal(idxTeleSchedule < idxAuditLog, true);
});



