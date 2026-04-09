/**
 * Google Sheets API Data Layer
 * Reads public Google Sheets via the Visualization API (gviz)
 */

const SHEET_TABS = {
    LEADS: 'DATA NGUỒN MKT HẢO',
    BOOKED: 'KHÁCH ĐẶT HẸN',
    ARRIVED: 'KHÁCH ĐÃ ĐẾN'
};

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

        const record = {
            stt: parseCellValue(cells[COL.STT]),
            date: parseGvizDate(cells[COL.DATE]),
            name: name ? String(name).trim() : '',
            phone: phone ? formatPhone(String(phone)) : '',
            service: parseCellValue(cells[COL.SERVICE]) || '',
            source: parseCellValue(cells[COL.SOURCE]) || '',
            link: parseCellValue(cells[COL.LINK]) || '',
            info: parseCellValue(cells[COL.INFO]) || '',
            status: parseCellValue(cells[COL.STATUS]) || '',
            time: parseCellValue(cells[COL.TIME]) || '',
            aptDate: parseGvizDate(cells[COL.APT_DATE]),
            staff: parseCellValue(cells[COL.STAFF]) || '',
            note: parseCellValue(cells[COL.NOTE]) || ''
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
