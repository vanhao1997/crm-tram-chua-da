/**
 * GOOGLE APPS SCRIPT — CRM TELESALE TRẠM CHỮA DA BSN (V2 - FULL 2-WAY SYNC & TELEGRAM BOT)
 * ============================================================================
 * TÍNH NĂNG CHÍNH:
 * 1. Đồng bộ 2 chiều từ Web CRM -> Google Sheet trên cả 3 tab:
 *    - 1) DATA NGUỒN MKT
 *    - 2) KHÁCH ĐẶT HẸN
 *    - 3) KHÁCH ĐÃ ĐẾN
 *    Tự động lưu: Tình trạng (Cột I), Giờ hẹn (Cột J), Ngày hẹn (Cột K),
 *    Telesale phụ trách (Cột L), Ghi chú tư vấn (Cột M), Thông tin KH (Cột H).
 * 2. Tự động đồng bộ liên Sheet:
 *    - Khách ở Sheet 1 chuyển sang ĐẶT HẸN / DỜI LỊCH -> Tự động ghi sang Sheet 2 (KHÁCH ĐẶT HẸN).
 *    - Khách ở Sheet 1 hoặc Sheet 2 chuyển sang ĐÃ ĐẾN -> Tự động ghi sang Sheet 3 (KHÁCH ĐÃ ĐẾN).
 *    - Khi sửa Ghi chú, Telesale, Giờ/Ngày hẹn ở bất kỳ tab nào -> Tự động cập nhật đồng bộ.
 * 3. Bot Telegram nhắc lịch hẹn tự động mỗi sáng (hoặc bấm gửi ngay):
 *    - Tự động quét danh sách khách có lịch hẹn Hôm nay / Ngày mai và gửi tin nhắn chi tiết vào nhóm Telegram.
 * ============================================================================
 */

// ================= CẤU HÌNH TELEGRAM BOT (ĐIỀN TẠI ĐÂY) =================
const TELEGRAM_BOT_TOKEN = ''; // VD: '7890123456:AAHxyz...' (Lấy từ @BotFather)
const TELEGRAM_CHAT_ID = '';   // VD: '-1001234567890' (ID nhóm Telegram hoặc ID cá nhân)

const SHEET_NAMES = {
  mkt: '1) DATA NGUỒN MKT',
  booked: '2) KHÁCH ĐẶT HẸN',
  arrived: '3) KHÁCH ĐÃ ĐẾN',
};

const COL = {
  STT: 1,           // Cột A
  DATA_DATE: 2,     // Cột B: NGÀY DATA (DD/MM/YYYY)
  NAME: 3,          // Cột C: TÊN KHÁCH HÀNG
  PHONE: 4,         // Cột D: SỐ ĐIỆN THOẠI
  SERVICE: 5,       // Cột E: DỊCH VỤ
  SOURCE: 6,        // Cột F: NGUỒN
  FB_LINK: 7,       // Cột G: LINK FB
  CUSTOMER_INFO: 8, // Cột H: THÔNG TIN KHÁCH HÀNG
  STATUS: 9,        // Cột I: TÌNH TRẠNG SỐ
  APPT_TIME: 10,    // Cột J: GIỜ HẸN
  APPT_DATE: 11,    // Cột K: NGÀY HẸN / NGÀY ĐẾN
  TELESALE: 12,     // Cột L: TELESALE PHỤ TRÁCH
  NOTE_M: 13,       // Cột M: GHI CHÚ TƯ VẤN (NOTE M)
  CARE_START: 14,   // Cột N..U: LỊCH SỬ CARE
  WEEKDAY: 22,      // Cột V: THỨ
  REVENUE: 23,      // Cột W: DOANH SỐ
};

/**
 * Tạo menu tiện ích ngay trên thanh công cụ Google Sheet
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🤖 CRM & Telegram BSN')
      .addItem('📨 Gửi lịch hẹn HÔM NAY qua Telegram', 'sendTodayAppointmentsToTelegram')
      .addItem('📅 Gửi lịch hẹn NGÀY MAI qua Telegram', 'sendTomorrowAppointmentsToTelegram')
      .addSeparator()
      .addItem('⏰ Cài đặt tự động báo Telegram 8h sáng mỗi ngày', 'setupDailyTelegramTrigger')
      .addToUi();
  } catch (e) {
    // Bỏ qua nếu chạy dưới dạng Web App không có UI
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'CRM Telesale Trạm Chữa Da BSN - Google Sheets & Telegram Connector v2',
    sheets: SHEET_NAMES,
    timestamp: new Date().toISOString(),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureDailyTelegramTriggerExists();
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = payload.action;

    switch (action) {
      case 'updateInteraction':
        return jsonResponse(handleUpdateInteraction(payload));
      case 'appendCareNote':
        return jsonResponse(handleAppendCareNote(payload));
      case 'addLead':
        return jsonResponse(handleAddLead(payload));
      case 'syncCustomerToSheet':
        return jsonResponse(handleSyncCustomerToSheet(payload));
      case 'sendTelegramReminder':
        return jsonResponse(handleSendTelegramFromWeb(payload));
      case 'sendSingleTelegram':
        return jsonResponse(handleSendSingleTelegramFromWeb(payload));
      default:
        return jsonResponse({ ok: false, error: 'Action không hợp lệ: ' + action });
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    lock.releaseLock();
  }
}

function getTargetSheet(sheetKeyOrName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mappedName = SHEET_NAMES[sheetKeyOrName] || sheetKeyOrName || SHEET_NAMES.mkt;
  const sheet = ss.getSheetByName(mappedName);
  if (!sheet) {
    throw new Error('Không tìm thấy sheet: ' + mappedName);
  }
  return sheet;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0084') && digits.length === 13) {
    return '0' + digits.slice(4);
  }
  if (digits.startsWith('84') && digits.length === 11) {
    return '0' + digits.slice(2);
  }
  if (digits.length === 9 && !digits.startsWith('0')) {
    return '0' + digits;
  }
  return digits;
}

function formatPhoneReadable(phone) {
  const norm = normalizePhone(phone);
  if (norm.length === 10) {
    return norm.slice(0, 4) + ' ' + norm.slice(4, 7) + ' ' + norm.slice(7);
  }
  return norm || String(phone || '').trim();
}

function formatCellDateToVn(cellVal) {
  if (!cellVal) return '';
  if (Object.prototype.toString.call(cellVal) === '[object Date]' && !isNaN(cellVal.getTime())) {
    return Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  }
  const str = String(cellVal).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[3] + '/' + isoMatch[2] + '/' + isoMatch[1];
  }
  const vnMatch = str.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (vnMatch) {
    const dd = ('0' + vnMatch[1]).slice(-2);
    const mm = ('0' + vnMatch[2]).slice(-2);
    let yyyy = vnMatch[3] || Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy');
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    return dd + '/' + mm + '/' + yyyy;
  }
  return str;
}

/**
 * Tìm dòng khách hàng theo rowIndex hoặc dò theo SĐT nếu dòng bị dịch chuyển
 */
function resolveRowIndex(sheet, requestedRowIndex, phone, name) {
  const lastRow = sheet.getLastRow();
  const targetPhone = normalizePhone(phone);

  if (requestedRowIndex && requestedRowIndex >= 2 && requestedRowIndex <= lastRow) {
    if (!targetPhone) return requestedRowIndex;
    const rowValues = sheet.getRange(requestedRowIndex, 1, 1, 6).getValues()[0];
    const rowPhone = normalizePhone(rowValues[3]);
    if (rowPhone === targetPhone) {
      return requestedRowIndex;
    }
  }

  if (targetPhone && lastRow >= 2) {
    const allData = sheet.getRange(1, 1, lastRow, 5).getValues();
    for (let i = allData.length - 1; i >= 1; i--) {
      if (normalizePhone(allData[i][3]) === targetPhone) {
        return i + 1;
      }
    }
  }

  if (requestedRowIndex && requestedRowIndex >= 2) {
    return requestedRowIndex;
  }
  throw new Error('Không xác định được dòng khách hàng trên Sheet: ' + sheet.getName());
}

/**
 * Cập nhật tương tác của Telesale trên Sheet hiện tại VÀ đồng bộ sang các Sheet liên quan
 * (1) DATA NGUỒN MKT <-> 2) KHÁCH ĐẶT HẸN <-> 3) KHÁCH ĐÃ ĐẾN)
 */
function handleUpdateInteraction(payload) {
  const sheet = getTargetSheet(payload.sheetKey || payload.sheetName);
  const rowIndex = resolveRowIndex(sheet, Number(payload.sheetRowIndex), payload.phone, payload.name);
  const updates = payload.updates || {};

  if (updates.customerInfo !== undefined) {
    sheet.getRange(rowIndex, COL.CUSTOMER_INFO).setValue(updates.customerInfo);
  }
  if (updates.status !== undefined) {
    sheet.getRange(rowIndex, COL.STATUS).setValue(updates.status);
  }
  if (updates.apptTime !== undefined) {
    sheet.getRange(rowIndex, COL.APPT_TIME).setValue(updates.apptTime);
  }
  if (updates.apptDate !== undefined) {
    sheet.getRange(rowIndex, COL.APPT_DATE).setValue(updates.apptDate);
  }
  if (updates.telesale !== undefined) {
    sheet.getRange(rowIndex, COL.TELESALE).setValue(updates.telesale);
  }
  if (updates.noteM !== undefined) {
    sheet.getRange(rowIndex, COL.NOTE_M).setValue(updates.noteM);
  }
  if (Array.isArray(updates.careHistory)) {
    var careTexts = [];
    for (var cIdx = 0; cIdx < updates.careHistory.length; cIdx++) {
      var cItem = updates.careHistory[cIdx];
      var cText = String((cItem && cItem.text !== undefined ? cItem.text : cItem) || '').trim();
      if (cText) careTexts.push(cText);
    }
    var maxCareCols = COL.WEEKDAY - COL.CARE_START; // 8 cột Care (N..U)
    var rowCareValues = [];
    for (var k = 0; k < maxCareCols; k++) {
      rowCareValues.push(k < careTexts.length ? careTexts[k] : '');
    }
    sheet.getRange(rowIndex, COL.CARE_START, 1, maxCareCols).setValues([rowCareValues]);
  }
  if (updates.weekday !== undefined) {
    sheet.getRange(rowIndex, COL.WEEKDAY).setValue(updates.weekday);
  }
  if (updates.revenue !== undefined) {
    sheet.getRange(rowIndex, COL.REVENUE).setValue(updates.revenue);
  }

  SpreadsheetApp.flush();

  // Đọc lại toàn bộ dòng sau khi đã cập nhật để đồng bộ liên Sheet
  const rowData = sheet.getRange(rowIndex, 1, 1, 23).getValues()[0];
  const currentStatus = String(rowData[COL.STATUS - 1] || '').trim().toUpperCase();
  const currentApptDate = formatCellDateToVn(rowData[COL.APPT_DATE - 1]);
  const syncedSheets = [];

  if (payload.autoSyncSheets !== false) {
    // 1. Nếu đang ở Sheet 1 (MKT) và khách có trạng thái ĐẶT HẸN / DỜI LỊCH (hoặc đã nhập Ngày hẹn) -> Đồng bộ sang Sheet 2 (KHÁCH ĐẶT HẸN)
    if (
      sheet.getName() === SHEET_NAMES.mkt &&
      (currentStatus.indexOf('ĐẶT HẸN') !== -1 ||
        currentStatus.indexOf('ĐẶT LỊCH') !== -1 ||
        currentStatus.indexOf('DỜI LỊCH') !== -1 ||
        Boolean(currentApptDate))
    ) {
      const targetStatus =
        currentStatus.indexOf('DỜI LỊCH') !== -1 ? 'DỜI LỊCH' : 'ĐẶT HẸN';
      syncedSheets.push(upsertRowIntoTargetSheet(SHEET_NAMES.booked, rowData, targetStatus));
    }

    // 2. Nếu khách ở Sheet 1 (MKT) hoặc Sheet 2 (KHÁCH ĐẶT HẸN) chuyển sang ĐÃ ĐẾN -> Đồng bộ sang Sheet 3 (KHÁCH ĐÃ ĐẾN)
    if (sheet.getName() !== SHEET_NAMES.arrived && currentStatus === 'ĐÃ ĐẾN') {
      syncedSheets.push(upsertRowIntoTargetSheet(SHEET_NAMES.arrived, rowData, 'ĐÃ ĐẾN'));
    }

    // 3. Nếu nhân sự sửa thông tin (Ghi chú, Telesale, Lịch hẹn, Tình trạng) ở Sheet 2 (KHÁCH ĐẶT HẸN) hoặc Sheet 3 (KHÁCH ĐÃ ĐẾN),
    //    tự động cập nhật ngược các trường tương tác về Sheet 1 (DATA NGUỒN MKT) nếu trùng SĐT để lưu lịch sử đồng nhất
    if (sheet.getName() !== SHEET_NAMES.mkt) {
      syncFieldsIfPhoneExists(SHEET_NAMES.mkt, rowData);
    }
    if (sheet.getName() === SHEET_NAMES.arrived) {
      syncFieldsIfPhoneExists(SHEET_NAMES.booked, rowData);
    }
  }

  return {
    ok: true,
    sheetName: sheet.getName(),
    rowIndex: rowIndex,
    syncedSheets: syncedSheets,
  };
}

/**
 * Cập nhật các cột H..U (Thông tin KH, Tình trạng, Giờ hẹn, Ngày hẹn, Telesale, Ghi chú M & Lịch sử Care N..U)
 * trên sheet đích nếu tìm thấy khách hàng có cùng SĐT
 */
function syncFieldsIfPhoneExists(targetSheetName, sourceRowData) {
  try {
    const phone = normalizePhone(sourceRowData[COL.PHONE - 1]);
    if (!phone) return null;
    const targetSheet = getTargetSheet(targetSheetName);
    const lastRow = targetSheet.getLastRow();
    if (lastRow < 2) return null;

    const phones = targetSheet.getRange(1, COL.PHONE, lastRow, 1).getValues();
    for (let i = phones.length - 1; i >= 1; i--) {
      if (normalizePhone(phones[i][0]) === phone) {
        const targetRowIdx = i + 1;
        const interactionCols = sourceRowData.slice(COL.CUSTOMER_INFO - 1, COL.WEEKDAY - 1);
        targetSheet.getRange(targetRowIdx, COL.CUSTOMER_INFO, 1, interactionCols.length).setValues([interactionCols]);
        return targetRowIdx;
      }
    }
  } catch (e) {
    // Ignore non-critical cross-sheet sync error
  }
  return null;
}

/**
 * Thêm ghi chú vào cột Care trống tiếp theo (từ cột N trở đi) hoặc cột M nếu cột M còn trống
 */
function handleAppendCareNote(payload) {
  const sheet = getTargetSheet(payload.sheetKey || payload.sheetName);
  const rowIndex = resolveRowIndex(sheet, Number(payload.sheetRowIndex), payload.phone, payload.name);
  const noteText = String(payload.note || '').trim();
  if (!noteText) {
    return { ok: false, error: 'Nội dung note trống' };
  }

  const rowValues = sheet.getRange(rowIndex, COL.NOTE_M, 1, 10).getValues()[0];
  let targetCol = COL.NOTE_M;
  for (let i = 0; i < rowValues.length; i++) {
    if (!String(rowValues[i] || '').trim()) {
      targetCol = COL.NOTE_M + i;
      break;
    }
    targetCol = COL.NOTE_M + i + 1;
  }

  sheet.getRange(rowIndex, targetCol).setValue(noteText);
  return {
    ok: true,
    sheetName: sheet.getName(),
    rowIndex: rowIndex,
    columnIndex: targetCol,
  };
}

/**
 * Thêm lead mới vào Sheet
 */
function handleAddLead(payload) {
  const sheet = getTargetSheet(payload.sheetKey || 'mkt');
  const lead = payload.lead || {};
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const dataRange = sheet.getRange(1, 1, lastRow, 7).getValues();

  let lastCustomerRow = 2;
  for (let i = dataRange.length - 1; i >= 1; i--) {
    const hasNameOrPhone = String(dataRange[i][2] || '').trim() || String(dataRange[i][3] || '').trim();
    const isMonthSeparator = String(dataRange[i][6] || '').trim().toUpperCase().startsWith('THÁNG');
    if (hasNameOrPhone || isMonthSeparator) {
      lastCustomerRow = i + 1;
      break;
    }
  }

  const targetRow = lastCustomerRow + 1;
  const phoneStr = normalizePhone(lead.phone);
  sheet.getRange(targetRow, COL.DATA_DATE).setValue(lead.dataDate || '');
  sheet.getRange(targetRow, COL.NAME).setValue(lead.name || '');
  sheet.getRange(targetRow, COL.PHONE).setValue(phoneStr ? "'" + phoneStr : '');
  sheet.getRange(targetRow, COL.SERVICE).setValue(lead.service || '');
  sheet.getRange(targetRow, COL.SOURCE).setValue(lead.source || 'Ads FB Mess');
  sheet.getRange(targetRow, COL.FB_LINK).setValue(lead.fbLink || '');
  sheet.getRange(targetRow, COL.CUSTOMER_INFO).setValue(lead.customerInfo || '');
  sheet.getRange(targetRow, COL.STATUS).setValue(lead.status || '');
  sheet.getRange(targetRow, COL.APPT_TIME).setValue(lead.apptTime || '');
  sheet.getRange(targetRow, COL.APPT_DATE).setValue(lead.apptDate || '');
  sheet.getRange(targetRow, COL.TELESALE).setValue(lead.telesale || '');
  sheet.getRange(targetRow, COL.NOTE_M).setValue(lead.noteM || '');

  return {
    ok: true,
    sheetName: sheet.getName(),
    rowIndex: targetRow,
  };
}

function handleSyncCustomerToSheet(payload) {
  const sourceSheet = getTargetSheet(payload.sourceSheetKey || 'mkt');
  const rowIndex = resolveRowIndex(sourceSheet, Number(payload.sheetRowIndex), payload.phone, payload.name);
  const rowData = sourceSheet.getRange(rowIndex, 1, 1, 23).getValues()[0];
  const targetSheetName = SHEET_NAMES[payload.targetSheetKey] || payload.targetSheetName || SHEET_NAMES.booked;
  const result = upsertRowIntoTargetSheet(targetSheetName, rowData, payload.overrideStatus);
  return {
    ok: true,
    synced: result,
  };
}

function upsertRowIntoTargetSheet(targetSheetName, rowData, overrideStatus) {
  const targetSheet = getTargetSheet(targetSheetName);
  const lastRow = Math.max(targetSheet.getLastRow(), 2);
  const phone = normalizePhone(rowData[COL.PHONE - 1]);

  const copyRow = rowData.slice(0, 23);
  if (overrideStatus) copyRow[COL.STATUS - 1] = overrideStatus;
  if (copyRow[COL.DATA_DATE - 1]) {
    copyRow[COL.DATA_DATE - 1] = formatCellDateToVn(copyRow[COL.DATA_DATE - 1]);
  }
  if (copyRow[COL.APPT_DATE - 1]) {
    copyRow[COL.APPT_DATE - 1] = formatCellDateToVn(copyRow[COL.APPT_DATE - 1]);
  }
  if (phone) {
    copyRow[COL.PHONE - 1] = "'" + phone;
  }

  if (phone && lastRow >= 2) {
    const existing = targetSheet.getRange(1, 1, lastRow, 5).getValues();
    for (let i = existing.length - 1; i >= 1; i--) {
      if (normalizePhone(existing[i][3]) === phone) {
        const existingRowIdx = i + 1;
        targetSheet.getRange(existingRowIdx, 2, 1, 12).setValues([copyRow.slice(1, 13)]);
        return { sheetName: targetSheetName, rowIndex: existingRowIdx, mode: 'updated' };
      }
    }
  }

  // Tìm dòng cuối cùng thực sự có dữ liệu trên sheet đích
  const checkRange = targetSheet.getRange(1, 1, lastRow, 5).getValues();
  let lastOccupiedRow = 1;
  for (let i = checkRange.length - 1; i >= 1; i--) {
    if (String(checkRange[i][2] || '').trim() || String(checkRange[i][3] || '').trim()) {
      lastOccupiedRow = i + 1;
      break;
    }
  }

  const newRowIdx = lastOccupiedRow + 1;
  targetSheet.getRange(newRowIdx, 1, 1, 13).setValues([copyRow.slice(0, 13)]);
  return { sheetName: targetSheetName, rowIndex: newRowIdx, mode: 'inserted' };
}

// ============================================================================
// PHẦN 2: BOT TELEGRAM TỰ ĐỘNG BÁO LỊCH HẸN KHÁCH HÀNG HÔM NAY / NGÀY MAI
// ============================================================================

/**
 * Gửi danh sách khách có lịch hẹn HÔM NAY vào Telegram
 */
function sendTodayAppointmentsToTelegram() {
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  return sendAppointmentsByDateToTelegram(todayStr, 'HÔM NAY');
}

/**
 * Gửi danh sách khách có lịch hẹn NGÀY MAI vào Telegram
 */
function sendTomorrowAppointmentsToTelegram() {
  const tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  return sendAppointmentsByDateToTelegram(tomorrowStr, 'NGÀY MAI');
}

function handleSendTelegramFromWeb(payload) {
  const targetDateVn = payload.dateVn || Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  const label = payload.label || 'HÔM NAY';
  const botToken = payload.botToken || TELEGRAM_BOT_TOKEN;
  const chatId = payload.chatId || TELEGRAM_CHAT_ID;
  if (payload.textHtml) {
    return sendRawTelegramHtml(payload.textHtml, botToken, chatId, { dateVn: targetDateVn });
  }
  return sendAppointmentsByDateToTelegram(targetDateVn, label, botToken, chatId);
}

function handleSendSingleTelegramFromWeb(payload) {
  const botToken = payload.botToken || TELEGRAM_BOT_TOKEN;
  const chatId = payload.chatId || TELEGRAM_CHAT_ID;
  if (payload.textHtml) {
    return sendRawTelegramHtml(payload.textHtml, botToken, chatId, { mode: 'single' });
  }
  const rec = payload.record || {};
  const apptDateText = rec.apptDate || rec.dataDate || Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  const lines = [
    '📅 <b>LỊCH HẸN KHÁCH HÀNG — (' + escapeTelegramHtml(apptDateText) + ')</b>',
    '<b>Trạm Chữa Da BSN</b> • Thông tin khách lẻ',
    '━━━━━━━━━━━━━━━━━━━━',
  ].concat(formatCustomerTelegramLinesGas(rec, 1));
  return sendRawTelegramHtml(lines.join('\n'), botToken, chatId, { mode: 'single' });
}

function formatCustomerTelegramLinesGas(item, idx) {
  const statusUpper = String(item.status || 'ĐẶT HẸN').trim().toUpperCase();
  const isArrivedOrLost =
    statusUpper.indexOf('ĐÃ ĐẾN') !== -1 ||
    statusUpper.indexOf('HỦY') !== -1 ||
    statusUpper.indexOf('TỪ CHỐI') !== -1;
  const statusBadge = isArrivedOrLost
    ? escapeTelegramHtml(statusUpper) + ' 🟢'
    : escapeTelegramHtml(statusUpper) + ' 🔴 <i>(Cần gọi nhắc)</i>';

  return [
    idx + '. ⏰ <b>' + escapeTelegramHtml(item.apptTime || 'Chưa báo giờ') + '</b> — <b>' + escapeTelegramHtml(item.name || 'Khách chưa rõ tên') + '</b>',
    '   📞 SĐT: <code>' + escapeTelegramHtml(item.phone || item.phoneDisplay || '—') + '</code>',
    '   💆 Dịch vụ: ' + escapeTelegramHtml(item.service || '—'),
    '   📌 Tình trạng: <b>' + statusBadge + '</b>',
    '   👩‍💼 Telesale: <b>' + escapeTelegramHtml(item.telesale || 'Chưa phân bổ') + '</b>',
    '   ℹ️ TT Khách: ' + escapeTelegramHtml(item.customerInfo || '—'),
    '   📝 Ghi chú: <i>' + escapeTelegramHtml(item.noteM || '—') + '</i>',
  ];
}

function sendRawTelegramHtml(text, customToken, customChatId, meta) {
  const token = String(customToken || TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(customChatId || TELEGRAM_CHAT_ID || '').trim();

  if (!token || !chatId) {
    throw new Error(
      'Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong Apps Script (hoặc file .env)'
    );
  }

  const telegramUrl = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const response = UrlFetchApp.fetch(telegramUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    muteHttpExceptions: true,
  });

  const resBody = JSON.parse(response.getContentText() || '{}');
  if (!resBody.ok) {
    throw new Error('Lỗi gửi Telegram: ' + (resBody.description || response.getContentText()));
  }

  return Object.assign({ ok: true }, meta || {});
}

/**
 * Quét Sheet 2 (KHÁCH ĐẶT HẸN) và Sheet 1 (DATA NGUỒN MKT) theo ngày hẹn DD/MM/YYYY
 * và gửi báo cáo chi tiết vào Telegram
 */
function sendAppointmentsByDateToTelegram(targetDateVn, titleLabel, customToken, customChatId) {
  const appointments = collectAppointmentsForDate(targetDateVn);
  let needCallCount = 0;
  for (let i = 0; i < appointments.length; i++) {
    const st = String(appointments[i].status || '').toUpperCase();
    if (st.indexOf('ĐÃ ĐẾN') === -1 && st.indexOf('HỦY') === -1 && st.indexOf('TỪ CHỐI') === -1) {
      needCallCount++;
    }
  }

  const lines = [];
  lines.push('📅 <b>LỊCH HẸN KHÁCH HÀNG — ' + escapeTelegramHtml(titleLabel) + ' (' + escapeTelegramHtml(targetDateVn) + ')</b>');
  lines.push('<b>Trạm Chữa Da BSN</b> • Tổng: <b>' + appointments.length + ' khách</b> (' + needCallCount + ' khách cần gọi nhắc)');
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  if (appointments.length === 0) {
    lines.push('Hiện chưa có khách hàng nào có lịch hẹn vào ngày ' + escapeTelegramHtml(targetDateVn) + '.');
  } else {
    for (let i = 0; i < appointments.length; i++) {
      const itemLines = formatCustomerTelegramLinesGas(appointments[i], i + 1);
      for (let j = 0; j < itemLines.length; j++) {
        lines.push(itemLines[j]);
      }
      if (i < appointments.length - 1) {
        lines.push('');
      }
    }
  }

  return sendRawTelegramHtml(lines.join('\n'), customToken, customChatId, {
    dateVn: targetDateVn,
    count: appointments.length,
  });
}

function collectAppointmentsForDate(targetDateVn) {
  const results = [];
  const seenPhones = {};
  const sheetsToScan = [SHEET_NAMES.booked, SHEET_NAMES.mkt];

  for (let s = 0; s < sheetsToScan.length; s++) {
    let sheet;
    try {
      sheet = getTargetSheet(sheetsToScan[s]);
    } catch (e) {
      continue;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;

    const values = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const name = String(row[COL.NAME - 1] || '').trim();
      const rawPhone = String(row[COL.PHONE - 1] || '').trim();
      const phone = normalizePhone(rawPhone);
      if (!name && !phone) continue;

      const apptDateVn = formatCellDateToVn(row[COL.APPT_DATE - 1]);
      if (apptDateVn !== targetDateVn) continue;

      const dedupeKey = (phone || name) + ':' + apptDateVn;
      if (seenPhones[dedupeKey]) continue;
      seenPhones[dedupeKey] = true;

      results.push({
        name: name || 'Khách chưa rõ tên',
        phone: phone,
        phoneDisplay: formatPhoneReadable(phone || rawPhone),
        service: String(row[COL.SERVICE - 1] || '').trim(),
        customerInfo: String(row[COL.CUSTOMER_INFO - 1] || '').trim(),
        status: String(row[COL.STATUS - 1] || 'ĐẶT HẸN').trim(),
        apptTime: String(row[COL.APPT_TIME - 1] || '').trim(),
        apptDate: apptDateVn,
        telesale: String(row[COL.TELESALE - 1] || '').trim(),
        noteM: String(row[COL.NOTE_M - 1] || '').trim(),
      });
    }
  }

  return results;
}

function ensureDailyTelegramTriggerExists() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'sendTodayAppointmentsToTelegram') {
        return true;
      }
    }
    ScriptApp.newTrigger('sendTodayAppointmentsToTelegram')
      .timeBased()
      .everyDays(1)
      .atHour(8)
      .inTimezone('Asia/Ho_Chi_Minh')
      .create();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Tự động tạo Trigger chạy hàm sendTodayAppointmentsToTelegram vào 8h00 sáng mỗi ngày
 */
function setupDailyTelegramTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendTodayAppointmentsToTelegram') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('sendTodayAppointmentsToTelegram')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('Asia/Ho_Chi_Minh')
    .create();

  try {
    SpreadsheetApp.getUi().alert(
      '✅ Đã cài đặt tự động gửi lịch hẹn hôm nay vào Telegram lúc 8h00–9h00 sáng mỗi ngày!'
    );
  } catch (e) {
    // Ignore if run from script editor without sheet UI
  }
}

function escapeTelegramHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
