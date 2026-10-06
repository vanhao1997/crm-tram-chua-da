/**
 * Google Sheets API Data Layer
 * Reads public Google Sheets via the Visualization API (gviz)
 */

import { dateKey, normalizeMarketingRecord } from '../analytics/budget-intelligence.js';

const SHEET_TABS = {
    LEADS: 'DATA NGUỒN MKT',
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
async function fetchInternalTab(sheetId, tabName) {
    const map = { [SHEET_TABS.LEADS]: 'leads', [SHEET_TABS.BOOKED]: 'booked', [SHEET_TABS.ARRIVED]: 'arrived', '2026': 'marketing' };
    const source = map[tabName]; if (!source) throw new Error(`Unknown Sheet tab: ${tabName}`);
    const response = await fetch(`/api/sheets?source=${source}`);
    if (!response.ok) throw new Error(`API nội bộ không đọc được tab "${tabName}"`);
    const payload = await response.json();
    if (!Array.isArray(payload?.values) || payload.values.some(row => !Array.isArray(row))) {
        throw new Error(`Dữ liệu API không hợp lệ cho tab "${tabName}"`);
    }
    const table = { rows: payload.values.map(row => ({ c: row.map(v => ({ v })) })) };
    table.metadata = payload.metadata || {};
    table.identities = Array.isArray(payload.identities) ? payload.identities : [];
    table.source = source;
    return table;
}

async function fetchTab(sheetId, tabName) { return fetchInternalTab(sheetId, tabName); }

/**
 * Fetch data from Marketing tab by GID
 */
async function fetchMarketingTab(sheetId) { return fetchInternalTab(sheetId, '2026'); }

function parseCellValue(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    return cell.v;
}

/**
 * Parse date from gviz date format: "Date(year, month, day)"
 */
function checkedDate(year, month, day, hour = 0, minute = 0) {
    const value = new Date(Date.UTC(year, month, day, hour, minute));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month || value.getUTCDate() !== day
        || value.getUTCHours() !== hour || value.getUTCMinutes() !== minute) return null;
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return new Date(`${key}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+07:00`);
}

function parseGvizDate(cell) {
    if (!cell || !cell.v) return null;

    // Handle gviz Date format
    if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
        const match = cell.v.match(/Date\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return checkedDate(Number(match[1]), Number(match[2]), Number(match[3]));
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
                return checkedDate(p3, p2 - 1, p1, hour, min);
            }
        }

        if (cell.v.includes('/')) return null;
        const iso = cell.v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return checkedDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
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

    for (const [rowIndex, row] of rows.entries()) {
        const cells = row.c || [];
        const name = parseCellValue(cells[COL.NAME]);
        const phone = parseCellValue(cells[COL.PHONE]);

        // Skip empty/header rows
        if (!name && !phone) continue;
        const headerText = String(name || '').trim().toUpperCase();
        if (['HỌ TÊN', 'HỌ VÀ TÊN', 'TÊN KH'].includes(headerText) || headerText.includes('KHÁCH ĐÃ ĐẾN')) continue;

        // Skip month separator rows (e.g., "THÁNG 2", "THÁNG 3")
        const infoVal = parseCellValue(cells[COL.INFO]);
        if (infoVal && typeof infoVal === 'string' && /^THÁNG\s+\d+/i.test(infoVal) && !name) continue;

        // Combine notes from column M (12) onwards
        let combinedNotes = '';
        for (let i = 12; i < Math.min(cells.length, 30); i++) {
            if (includeRevenue && i >= 21) continue;
            const val = parseCellValue(cells[i]);
            if (val) combinedNotes += String(val).trim() + ' | ';
        }
        combinedNotes = combinedNotes.replace(/ \| $/, '');

        let rawStatus = parseCellValue(cells[COL.STATUS]) || '';
        const normalized = normalizeStatus(rawStatus);
        if (normalized === 'unknown' || normalized === 'other') {
            const lowerNote = combinedNotes.toLocaleLowerCase('vi-VN');
            if (lowerNote.includes('hủy') || lowerNote.includes('huỷ') || lowerNote.includes('không đi')) rawStatus = 'Hủy Lịch';
            else if (lowerNote.includes('dời') || lowerNote.includes('đổi ý')) rawStatus = 'Dời Lịch';
            else if (lowerNote.includes('thuê bao') || lowerNote.includes('tắt máy')) rawStatus = 'Thuê Bao';
            else if (lowerNote.includes('không nghe máy') || lowerNote.includes('knm') || lowerNote.includes('ko nghe')) rawStatus = 'Không Nghe Máy';
            else if (lowerNote.includes('không hoàn thành') || lowerNote.includes('fail')) rawStatus = 'Không Hoàn Thành';
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
            note: combinedNotes,
            sourceRow: rowIndex + 1
        };
        const identity = table.identities?.[rowIndex];
        if (identity && typeof identity === 'object') {
            const { source: identitySource, sourceRow, ...identityFields } = identity;
            Object.assign(record, identityFields);
            if (sourceRow) record.sourceRow = sourceRow;
            record.sourceIdentity = { ...identity };
            record.provenance = {
                source: identitySource || table.source,
                sourceRow: sourceRow || record.sourceRow,
                derived: Boolean(identity.derived),
                persisted: identity.persisted !== false
            };
        } else {
            const fallbackId = `row:${table.source || 'sheet'}:${record.sourceRow}`;
            record.recordId = fallbackId;
            record.persisted = false;
            record.sourceIdentity = { recordId: fallbackId, source: table.source, sourceRow: record.sourceRow, persisted: false, derived: false };
            record.provenance = { source: table.source, sourceRow: record.sourceRow, derived: false, persisted: false };
        }

        if (includeRevenue) {
            // Historical rows use V; later rows use W with weekday text in V.
            const currentRevenue = parseCurrencyStr(parseCellValue(cells[22]));
            const legacyRevenue = parseCurrencyStr(parseCellValue(cells[21]));
            record.revenue = currentRevenue ?? legacyRevenue;
        }

        results.push(record);
    }

    return results;
}

function uniqueByKey(values, keyFn) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const key = keyFn(value);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}

function aggregateMetadata(tables) {
    const sourceMetadata = Object.fromEntries(Object.entries(tables).map(([source, table]) => [source, table.metadata || {}]));
    const entries = Object.values(sourceMetadata);
    const warnings = [...new Set(entries.flatMap(meta => Array.isArray(meta.warnings) ? meta.warnings : []))];
    const issues = uniqueByKey(
        entries.flatMap(meta => Array.isArray(meta.integrity?.issues) ? meta.integrity.issues : []),
        issue => JSON.stringify([issue.code, issue.source, issue.dateKey, issue.row, issue.message])
    );
    const fetchedTimes = entries.map(meta => Date.parse(meta.fetchedAt)).filter(Number.isFinite);
    const fetchedAt = fetchedTimes.length ? new Date(Math.min(...fetchedTimes)).toISOString() : undefined;
    const snapshotIds = [...new Set(entries.map(meta => meta.snapshotId).filter(Boolean))];
    return {
        ...(entries[0] || {}),
        sourceMetadata,
        fetchedAt,
        snapshotId: snapshotIds.length === 1 ? snapshotIds[0] : snapshotIds.join(','),
        stale: entries.some(meta => meta.stale === true || meta.status === 'stale' || meta.status === 'expired'),
        warnings,
        integrity: issues.length ? {
            checkedAt: entries.find(meta => meta.integrity?.checkedAt)?.integrity.checkedAt,
            ok: !issues.some(issue => issue.severity === 'critical'),
            issues
        } : entries.find(meta => meta.integrity)?.integrity
    };
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

    return {
        leads,
        booked,
        arrived,
        metadata: aggregateMetadata({ leads: leadsTable, booked: bookedTable, arrived: arrivedTable })
    };
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
    if (amount === null || amount === undefined || amount === '' || !Number.isFinite(Number(amount))) return '0';
    const value = Number(amount);
    const abs = Math.abs(value);
    if (abs >= 1e9) return (value / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (value / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (value / 1e3).toFixed(0) + 'K';
    return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

/**
 * Format date to DD/MM
 */
export function formatDateShort(date) {
    const key = dateKey(date);
    if (!key) return '--';
    return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/**
 * Format date to DD/MM/YYYY
 */
export function formatDateFull(date) {
    const key = dateKey(date);
    if (!key) return '--';
    return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
}

/**
 * Clean currency string to number
 */
export function parseCurrencyStr(str) {
    if (str === null || str === undefined || str === '') return null;
    if (typeof str === 'number') return str;
    const cleanStr = String(str).replace(/[đ₫\s,.]/g, '');
    const num = parseFloat(cleanStr);
    return Number.isFinite(num) ? num : null;
}

/**
 * Parse marketing records 
 */
function parseMarketingRows(table) {
    const rows = table.rows || [];
    const cellValue = cell => (cell && typeof cell === 'object' && 'v' in cell) ? cell.v : cell;
    const results = [];

    for (const row of rows) {
        const cells = row.c || [];

        const dateStrObj = cells[0];
        if (!dateStrObj || !cellValue(dateStrObj)) continue;

        const dateStr = String(cellValue(dateStrObj)).trim();
        // Skip aggregate rows (TỔNG, THÁNG...)
        if (dateStr.toUpperCase().includes('TỔNG') || dateStr.toUpperCase().includes('THÁNG') || dateStr === '') continue;

        const dateObj = parseGvizDate(dateStrObj);
        if (!dateObj) continue; // Only process valid daily rows

        results.push({
            date: dateObj,
            received: parseCurrencyStr(cellValue(cells[2])),
            marketing_cost: parseCurrencyStr(parseCellValue(cells[3])),
            ad_management_fee: parseCurrencyStr(parseCellValue(cells[4])),
            cost: parseCurrencyStr(parseCellValue(cells[5])),
            data_nangco: parseCellValue(cells[6]) == null ? null : Number(parseCellValue(cells[6])),
            data_muichi: parseCellValue(cells[7]) == null ? null : Number(parseCellValue(cells[7])),
            data_khac: parseCellValue(cells[8]) == null ? null : Number(parseCellValue(cells[8])),
            hen_nangco: parseCellValue(cells[9]) == null ? null : Number(parseCellValue(cells[9])),
            hen_muichi: parseCellValue(cells[10]) == null ? null : Number(parseCellValue(cells[10])),
            hen_khac: parseCellValue(cells[11]) == null ? null : Number(parseCellValue(cells[11])),
            toi_nangco: parseCellValue(cells[12]) == null ? null : Number(parseCellValue(cells[12])),
            toi_muichi: parseCellValue(cells[13]) == null ? null : Number(parseCellValue(cells[13])),
            toi_khac: parseCellValue(cells[14]) == null ? null : Number(parseCellValue(cells[14])),
            revenue: parseCurrencyStr(parseCellValue(cells[15])),
            messages: parseCellValue(cells[17]) == null ? null : Number(parseCellValue(cells[17]))
        });
    }

    return results;
}

/**
 * Fetch Marketing Data
 */
export async function fetchMarketingData(sheetId) {
    const table = await fetchMarketingTab(sheetId);
    const rows = parseMarketingRows(table);
    const normalized = rows.map(row => normalizeMarketingRecord(row));
    normalized.metadata = table.metadata || {};
    return normalized;
}
