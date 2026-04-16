/**
 * Google Sheets Write API
 * Uses Google Apps Script Web App as a proxy to write data back to Sheet
 */

const STORAGE_KEY_SCRIPT_URL = 'bsn_apps_script_url';

/**
 * Get/Set the Apps Script Web App URL
 */
export function getAppsScriptUrl() {
    return localStorage.getItem(STORAGE_KEY_SCRIPT_URL) || '';
}

export function setAppsScriptUrl(url) {
    localStorage.setItem(STORAGE_KEY_SCRIPT_URL, url.trim());
}

/**
 * Send a POST request to the Apps Script Web App
 */
async function postToSheet(action, payload) {
    const url = getAppsScriptUrl();
    if (!url) {
        throw new Error('Chưa cấu hình Apps Script URL. Vui lòng paste URL vào phần cài đặt.');
    }

    const body = JSON.stringify({ action, ...payload });

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // Apps Script requires text/plain for CORS
        body,
    });

    if (!response.ok) {
        throw new Error(`Lỗi kết nối Apps Script: ${response.status}`);
    }

    const result = await response.json();
    if (result.error) {
        throw new Error(result.error);
    }

    return result;
}

/**
 * Add a new lead to the "DATA NGUỒN MKT HẢO" sheet tab
 */
export async function addLead({ name, phone, service, source, note }) {
    return postToSheet('addLead', { name, phone, service, source, note });
}

/**
 * Update lead status in the Sheet
 */
export async function updateStatus({ phone, tab, row, status }) {
    return postToSheet('updateStatus', { phone, tab, row, status });
}

/**
 * Update lead note in the Sheet
 */
export async function updateNote({ phone, tab, row, note }) {
    return postToSheet('updateNote', { phone, tab, row, note });
}

/**
 * Check if a phone number already exists in the dataset
 * Returns matching records if found
 */
export function checkDuplicate(phone, allData) {
    const normalized = normalizePhone(phone);
    if (!normalized || normalized.length < 9) return [];

    const matches = [];
    const datasets = [
        { data: allData.leads || [], tab: 'Leads' },
        { data: allData.booked || [], tab: 'Đặt Hẹn' },
        { data: allData.arrived || [], tab: 'Đã Đến' },
    ];

    for (const { data, tab } of datasets) {
        for (const record of data) {
            const rPhone = normalizePhone(record.phone);
            if (rPhone && rPhone === normalized) {
                matches.push({ ...record, _tab: tab });
            }
        }
    }

    return matches;
}

/**
 * Normalize phone: strip non-digits, prepend 0 if 9 digits
 */
function normalizePhone(phone) {
    if (!phone) return '';
    let p = String(phone).replace(/\D/g, '');
    if (p.length === 9) p = '0' + p;
    return p;
}
