/**
 * BSN CRM — Google Apps Script (Write Proxy)
 * 
 * HƯỚNG DẪN CÀI ĐẶT:
 * 1. Mở Google Sheet → Extensions → Apps Script
 * 2. Xóa code mặc định, paste toàn bộ code bên dưới
 * 3. Click Deploy → New Deployment
 * 4. Type: Web app
 * 5. Execute as: Me
 * 6. Who has access: Anyone
 * 7. Click Deploy → Copy URL
 * 8. Paste URL vào BSN Dashboard (nút ⚙️)
 */

// ─── CONFIG ───
// Tab names in your Google Sheet (must match exactly)
var TAB_LEADS = 'DATA NGUỒN MKT HẢO';
var TAB_BOOKED = 'KHÁCH ĐẶT HẸN';
var TAB_ARRIVED = 'KHÁCH ĐÃ ĐẾN';

// Column indexes (1-based for Apps Script)
var COL_STT = 1;      // A
var COL_DATE = 2;      // B
var COL_NAME = 3;      // C
var COL_PHONE = 4;     // D
var COL_SERVICE = 5;   // E
var COL_SOURCE = 6;    // F
var COL_LINK = 7;      // G
var COL_INFO = 8;      // H
var COL_STATUS = 9;    // I
var COL_TIME = 10;     // J
var COL_APT_DATE = 11; // K
var COL_STAFF = 12;    // L
var COL_NOTE = 13;     // M

// ─── WEB APP ENTRY POINT ───
function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);
        var action = data.action;

        var result;
        switch (action) {
            case 'addLead':
                result = handleAddLead(data);
                break;
            case 'updateStatus':
                result = handleUpdateStatus(data);
                break;
            case 'updateNote':
                result = handleUpdateNote(data);
                break;
            default:
                return jsonResponse({ error: 'Unknown action: ' + action });
        }

        return jsonResponse(result);
    } catch (err) {
        return jsonResponse({ error: err.message });
    }
}

// Allow GET for testing
function doGet(e) {
    return jsonResponse({ status: 'ok', message: 'BSN CRM Write API is running' });
}

// ─── HANDLERS ───

function handleAddLead(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(TAB_LEADS);
    if (!sheet) return { error: 'Tab "' + TAB_LEADS + '" not found' };

    var lastRow = sheet.getLastRow();
    var newRow = lastRow + 1;
    var newSTT = lastRow; // Simple auto-increment

    // Format today's date as DD/MM/YYYY
    var today = new Date();
    var dateStr = Utilities.formatDate(today, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');

    sheet.getRange(newRow, COL_STT).setValue(newSTT);
    sheet.getRange(newRow, COL_DATE).setValue(dateStr);
    sheet.getRange(newRow, COL_NAME).setValue(data.name || '');
    sheet.getRange(newRow, COL_PHONE).setValue(formatPhone(data.phone || ''));
    sheet.getRange(newRow, COL_SERVICE).setValue(data.service || '');
    sheet.getRange(newRow, COL_SOURCE).setValue(data.source || '');

    if (data.note) {
        sheet.getRange(newRow, COL_NOTE).setValue(data.note);
    }

    return { success: true, row: newRow, stt: newSTT };
}

function handleUpdateStatus(data) {
    var phone = normalizePhone(data.phone);
    if (!phone) return { error: 'Missing phone number' };

    var tabName = getTabName(data.tab);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return { error: 'Tab "' + tabName + '" not found' };

    // Find row by phone number
    var rowIndex = findRowByPhone(sheet, phone);
    if (rowIndex === -1) return { error: 'Phone ' + phone + ' not found in ' + tabName };

    sheet.getRange(rowIndex, COL_STATUS).setValue(data.status);

    return { success: true, row: rowIndex, status: data.status };
}

function handleUpdateNote(data) {
    var phone = normalizePhone(data.phone);
    if (!phone) return { error: 'Missing phone number' };

    var tabName = getTabName(data.tab);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return { error: 'Tab "' + tabName + '" not found' };

    var rowIndex = findRowByPhone(sheet, phone);
    if (rowIndex === -1) return { error: 'Phone ' + phone + ' not found in ' + tabName };

    sheet.getRange(rowIndex, COL_NOTE).setValue(data.note);

    return { success: true, row: rowIndex };
}

// ─── HELPERS ───

function findRowByPhone(sheet, phone) {
    var data = sheet.getRange(1, COL_PHONE, sheet.getLastRow()).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
        var cellPhone = normalizePhone(String(data[i][0]));
        if (cellPhone === phone) {
            return i + 1; // 1-indexed
        }
    }
    return -1;
}

function normalizePhone(phone) {
    if (!phone) return '';
    var p = String(phone).replace(/\D/g, '');
    if (p.length === 9) p = '0' + p;
    return p;
}

function formatPhone(phone) {
    var p = normalizePhone(phone);
    if (p.length === 10) {
        return p.substr(0, 4) + ' ' + p.substr(4, 3) + ' ' + p.substr(7);
    }
    return p;
}

function getTabName(tab) {
    switch (tab) {
        case 'leads': return TAB_LEADS;
        case 'booked': return TAB_BOOKED;
        case 'arrived': return TAB_ARRIVED;
        default: return TAB_LEADS;
    }
}

function jsonResponse(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}
