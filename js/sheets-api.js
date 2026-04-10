/**
 * Google Sheets API Data Layer
 * Reads public Google Sheets via the Visualization API (gviz)
 */

const SHEET_TABS = {
    LEADS: 'DATA NGUỒN MKT HẢO',
    BOOKED: 'KHÁCH ĐẶT HẸN',
    ARRIVED: 'KHÁCH ĐÃ ĐẾN'
};

const MKT_GID = '1227076939';

// Column mapping (0-indexed based on gviz response)
const COL = {
    STT: 0,      // A
    DATE: 1,     // B - Ngày data
    NAME: 2,     // C - Họ tên
    PHONE: 3,    // D - SĐT
    SERVICE: 4,  // E - Dịch vụ
    SOURCE: 5,   // F - Nguồn
    LINK: 6,     // G - Link FB
    INFO: 7,     // H - Thông tin KH
    STATUS: 8,   // I - Trạng thái
    TIME: 9,     // J - Giờ hẹn
    APT_DATE: 10,// K - Ngày hẹn
    STAFF: 11,   // L - NV
    NOTE: 12,    // M - Ghi chú
    REVENUE: 22  // W - Doanh số (only in ARRIVED tab)
};

/**
 * Extract Sheet ID from Google Sheets URL
 */
export function parseSheetUrl(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) throw new Error('URL Google Sheet không hợp lệ');
    return match[1];
}

/**
 * Fetch data from a single sheet tab
 */
async function fetchTab(sheetId, tabName) {
    const encodedTab = encodeURIComponent(tabName);
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodedTab}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Không thể tải tab "${tabName}"`);

    const text = await response.text();

    // gviz returns JSONP-like: google.visualization.Query.setResponse({...})
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);
    if (!jsonMatch) throw new Error(`Dữ liệu tab "${tabName}" không hợp lệ`);

    const data = JSON.parse(jsonMatch[1]);

    if (data.status === 'error') {
        throw new Error(data.errors?.[0]?.message || 'Lỗi không xác định');
    }

    return data.table;
}

/**
 * Fetch data from Marketing tab by GID
 */
async function fetchMarketingTab(sheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${MKT_GID}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Không thể tải tab Marketing`);

    const text = await response.text();

    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);
    if (!jsonMatch) throw new Error(`Dữ liệu tab Marketing không hợp lệ`);

    const data = JSON.parse(jsonMatch[1]);

    if (data.status === 'error') {
        throw new Error(data.errors?.[0]?.message || 'Lỗi không xác định');
    }

    return data.table;
}

/**
 * Parse a gviz cell value
 */
function parseCellValue(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    return cell.v;
}

/**
 * Parse date from gviz date format: "Date(year, month, day)"
 */
function parseGvizDate(cell) {
    if (!cell || !cell.v) return null;

    // Handle gviz Date format
    if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
        const match = cell.v.match(/Date\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
        }
    }

    // Handle regular date values
    if (cell.v instanceof Date) return cell.v;
    if (typeof cell.v === 'string') {
        // Handle explicit string format DD/MM/YYYY or DD/MM/YYYY HH:mm
        const parts = cell.v.split(/[\s/:-]/);
        if (cell.v.includes('/') && parts.length >= 3) {
            // Check if it's likely DD/MM/YYYY
            const p1 = parseInt(parts[0], 10);
            const p2 = parseInt(parts[1], 10);
            const p3 = parseInt(parts[2], 10);

            // Typical DD/MM/YYYY format
            if (p3 > 1900 && p2 <= 12 && p1 <= 31) {
                const hour = parts[3] ? parseInt(parts[3], 10) : 0;
                const min = parts[4] ? parseInt(parts[4], 10) : 0;
                return new Date(p3, p2 - 1, p1, hour, min);
            }
        }

        const d = new Date(cell.v);
        return isNaN(d.getTime()) ? null : d;
    }

    return null;
}

/**
 * Parse rows from a gviz table into structured objects
 */
function parseRows(table, includeRevenue = false) {
    const rows = table.rows || [];
    const results = [];

    for (const row of rows) {
        const cells = row.c || [];
        const name = parseCellValue(cells[COL.NAME]);
        const phone = parseCellValue(cells[COL.PHONE]);

        // Skip empty/header rows
        if (!name && !phone) continue;

        // Skip month separator rows (e.g., "THÁNG 2", "THÁNG 3")
        const infoVal = parseCellValue(cells[COL.INFO]);
        if (infoVal && typeof infoVal === 'string' && /^THÁNG\s+\d+/i.test(infoVal) && !name) continue;

        // Combine notes from column M (12) onwards
        let combinedNotes = '';
        for (let i = 12; i < Math.min(cells.length, 30); i++) {
            const val = parseCellValue(cells[i]);
            if (val) combinedNotes += String(val).trim() + ' | ';
        }
        combinedNotes = combinedNotes.replace(/ \| $/, '');

        let rawStatus = parseCellValue(cells[COL.STATUS]) || '';
        let normalized = normalizeStatus(rawStatus);

        // Smart Status: If status is empty or unknown, infer from notes
        if (normalized === 'unknown' || normalized === 'other') {
            const lowerNote = combinedNotes.toLowerCase();
            if (lowerNote.includes('hủy') || lowerNote.includes('không đi') || lowerNote.includes('huỷ')) {
                rawStatus = 'Hủy Lịch';
            } else if (lowerNote.includes('dời') || lowerNote.includes('đổi ý')) {
                rawStatus = 'Dời Lịch';
            } else if (lowerNote.includes('thuê bao') || lowerNote.includes('tắt máy')) {
                rawStatus = 'Thuê Bao';
            } else if (lowerNote.includes('không nghe máy') || lowerNote.includes('knm') || lowerNote.includes('ko nghe')) {
                rawStatus = 'Không Nghe Máy';
            } else if (lowerNote.includes('không hoàn thành') || lowerNote.includes('fail')) {
                rawStatus = 'Không Hoàn Thành';
            }
        }

        const record = {
            stt: parseCellValue(cells[COL.STT]),
            date: parseGvizDate(cells[COL.DATE]),
            name: name ? String(name).trim() : '',
            phone: phone ? formatPhone(String(phone)) : '',
            service: parseCellValue(cells[COL.SERVICE]) || '',
            source: parseCellValue(cells[COL.SOURCE]) || '',
            link: parseCellValue(cells[COL.LINK]) || '',
            info: parseCellValue(cells[COL.INFO]) || '',
            status: String(rawStatus).trim(),
            time: parseCellValue(cells[COL.TIME]) || '',
            aptDate: parseGvizDate(cells[COL.APT_DATE]),
            staff: parseCellValue(cells[COL.STAFF]) || '',
            note: combinedNotes
        };

        if (includeRevenue && cells[COL.REVENUE]) {
            record.revenue = parseCellValue(cells[COL.REVENUE]) || 0;
        }

        results.push(record);
    }

    return results;
}

/**
 * Format phone number
 */
function formatPhone(phone) {
    let p = String(phone).replace(/\D/g, '');
    if (p.length === 9) p = '0' + p;
    return p;
}

/**
 * Fetch all dashboard data from Google Sheet
 */
export async function fetchAllData(sheetId) {
    const [leadsTable, bookedTable, arrivedTable] = await Promise.all([
        fetchTab(sheetId, SHEET_TABS.LEADS),
        fetchTab(sheetId, SHEET_TABS.BOOKED),
        fetchTab(sheetId, SHEET_TABS.ARRIVED)
    ]);

    const leads = parseRows(leadsTable);
    const booked = parseRows(bookedTable);
    const arrived = parseRows(arrivedTable, true);

    // FIX DATA INTEGRITY: Force status 'Đã đến' for any lead/booking that exists in Arrived list
    // This handles the reality where telesales forget to update the source tracker.
    const arrivedPhones = new Set();
    arrived.forEach(item => {
        if (item.phone) {
            arrivedPhones.add(item.phone.replace(/^0/, ''));
        }
    });

    const fixStatus = (list) => {
        list.forEach(item => {
            if (item.phone) {
                const normPhone = item.phone.replace(/^0/, '');
                if (arrivedPhones.has(normPhone)) {
                    item.status = 'Đã Đến';
                }
            }
        });
    };

    fixStatus(leads);
    fixStatus(booked);

    return { leads, booked, arrived };
}

/**
 * Normalize status text for comparison
 */
export function normalizeStatus(status) {
    if (!status) return 'unknown';
    const s = status.trim().toUpperCase();

    if (s.includes('ĐÃ ĐẾN')) return 'arrived';
    if (s.includes('ĐẶT HẸN') || s.includes('ĐẶT HẸNT')) return 'booked';
    if (s.includes('DỜI') || s.includes('DỜI LỊCH')) return 'rescheduled';
    if (s.includes('HỦY') || s.includes('HUỶ')) return 'cancelled';
    if (s.includes('KHÔNG NGHE') || s.includes('KNM')) return 'no_answer';
    if (s.includes('THUÊ BAO')) return 'disconnected';
    if (s.includes('KHÔNG HOÀN THÀNH')) return 'failed';

    return 'other';
}

/**
 * Format currency VNĐ
 */
export function formatCurrency(amount) {
    if (!amount || isNaN(amount)) return '0';
    if (amount >= 1e9) return (amount / 1e9).toFixed(1) + 'B';
    if (amount >= 1e6) return (amount / 1e6).toFixed(1) + 'M';
    if (amount >= 1e3) return (amount / 1e3).toFixed(0) + 'K';
    return amount.toLocaleString('vi-VN');
}

/**
 * Format date to DD/MM
 */
export function formatDateShort(date) {
    if (!date) return '--';
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format date to DD/MM/YYYY
 */
export function formatDateFull(date) {
    if (!date) return '--';
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/**
 * Clean currency string to number
 */
export function parseCurrencyStr(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const cleanStr = String(str).replace(/[đ₫\s,.]/g, '');
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

/**
 * Parse marketing records 
 */
function parseMarketingRows(table) {
    const rows = table.rows || [];
    const results = [];

    for (const row of rows) {
        const cells = row.c || [];

        const dateStrObj = cells[0];
        if (!dateStrObj || !dateStrObj.v) continue;
        const dateStr = String(dateStrObj.v).trim();

        // Skip aggregate rows (TỔNG, THÁNG...)
        if (dateStr.toUpperCase().includes('TỔNG') || dateStr.toUpperCase().includes('THÁNG') || dateStr === '') continue;

        const dateObj = parseGvizDate(dateStrObj);
        if (!dateObj) continue; // Only process valid daily rows

        results.push({
            date: dateObj,
            cost: parseCurrencyStr(parseCellValue(cells[5])),
            data_nangco: Number(parseCellValue(cells[6])) || 0,
            data_muichi: Number(parseCellValue(cells[7])) || 0,
            data_khac: Number(parseCellValue(cells[8])) || 0,
            hen_nangco: Number(parseCellValue(cells[9])) || 0,
            hen_muichi: Number(parseCellValue(cells[10])) || 0,
            hen_khac: Number(parseCellValue(cells[11])) || 0,
            toi_nangco: Number(parseCellValue(cells[12])) || 0,
            toi_muichi: Number(parseCellValue(cells[13])) || 0,
            toi_khac: Number(parseCellValue(cells[14])) || 0,
            revenue: parseCurrencyStr(parseCellValue(cells[15]))
        });
    }

    return results;
}

/**
 * Fetch Marketing Data
 */
export async function fetchMarketingData(sheetId) {
    const table = await fetchMarketingTab(sheetId);
    return parseMarketingRows(table);
}
