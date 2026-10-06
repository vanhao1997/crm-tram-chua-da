import crypto from 'node:crypto';

export const IDENTITY_HEADERS = ['bsn_record_id', 'lead_id', 'appointment_id', 'visit_id', 'bsn_updated_at', 'bsn_business_hash'];
export function calendarDay(value) {
    const match = String(value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
    if (!match) return null;
    const key = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    const date = new Date(`${key}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}
export function normalizePhone(value) {
    let phone = String(value ?? '').replace(/\D/g, '');
    if (phone.startsWith('84') && phone.length >= 11) phone = `0${phone.slice(2)}`;
    return phone.length === 9 ? `0${phone}` : phone;
}
export function isCustomerRow(row) {
    return Array.isArray(row) && Boolean(row[2] || row[3])
        && !/^(HỌ TÊN|HỌ VÀ TÊN|TÊN KH)$/i.test(String(row[2] || '').trim());
}
export function serviceGroup(value) {
    const text = String(value || '').trim().toLocaleLowerCase('vi-VN');
    if (/nâng cơ|\bnc\b/.test(text)) return 0;
    if (/mũi chỉ|mũi sợi/.test(text)) return 1;
    return 2;
}
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const isConfirmedBooking = value => /^đặt\s+hẹnt?$/i.test(String(value || '').trim());
export function businessHash(row) {
    return crypto.createHash('sha256').update(JSON.stringify(row.slice(0, 26))).digest('hex');
}
export function parseIdentities(values, rowCount) {
    if (!values?.[0] || !IDENTITY_HEADERS.every((header, i) => values[0][i] === header)) return [];
    return Array.from({ length: rowCount }, (_, index) => {
        if (index === 0) return null;
        const row = values[index];
        if (!row?.[0]) return null;
        return { recordId: row[0], leadId: row[1] || null, appointmentId: row[2] || null,
            visitId: row[3] || null, updatedAt: row[4] || null, sourceRow: index + 1 };
    });
}

export function inspectCrm(snapshot, checkedAt = new Date().toISOString()) {
    const issues = [];
    const sources = snapshot?.sources || {};
    const leadRows = sources.leads?.values || [];
    const bookedRows = sources.booked?.values || [];
    const bookedPhones = new Set(bookedRows.filter(isCustomerRow).map(row => normalizePhone(row[3])));
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
        .formatToParts(new Date(checkedAt));
    const currentMonth = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
    for (const [source, result] of Object.entries(sources)) {
        if (!(result.values || []).length) issues.push({ code: 'CRM_EMPTY_SOURCE', severity: 'critical', source,
            message: 'Nguồn CRM không có bảng dữ liệu để xác nhận số liệu.' });
        const ids = new Set();
        for (const [index, row] of (result.values || []).entries()) {
            if (!isCustomerRow(row)) continue;
            const dateKey = calendarDay(source === 'leads' ? row[1] : source === 'booked' ? row[10] : row[10] || row[1]);
            if (!dateKey) issues.push({ code: 'CRM_INVALID_DATE', severity: 'critical', source, row: index + 1,
                message: 'Bản ghi CRM thiếu ngày hợp lệ.' });
            const recordId = result.identities?.[index]?.recordId;
            if (!recordId && result.metadata?.identityAvailable !== false) issues.push({ code: 'RECORD_ID_MISSING', severity: 'warning', source, row: index + 1, dateKey,
                message: 'Bản ghi chưa có khóa ổn định.' });
            else if (recordId && ids.has(recordId)) issues.push({ code: 'RECORD_ID_DUPLICATE', severity: 'critical', source, row: index + 1, dateKey,
                message: 'Khóa bản ghi bị trùng.' });
            else ids.add(recordId);
        }
    }
    for (const [index, row] of leadRows.entries()) {
        const dateKey = calendarDay(row[1]);
        if (isCustomerRow(row) && dateKey?.slice(0, 7) === currentMonth
            && isConfirmedBooking(row[8]) && !bookedPhones.has(normalizePhone(row[3]))) {
            issues.push({ code: 'APPOINTMENT_MISSING', severity: 'critical', source: 'leads', row: index + 1, dateKey,
                message: 'Lead đặt hẹn chưa có bản ghi trong tab lịch hẹn.' });
        }
    }
    return { checkedAt, ok: !issues.some(issue => issue.severity === 'critical'), issues };
}

export function reconcileSources(crm, marketing, checkedAt = new Date().toISOString()) {
    const issues = [...(crm?.integrity?.issues || [])];
    const crmSources = crm?.sources;
    if (!crmSources || Object.values(crmSources).some(source => source.metadata?.stale)) {
        issues.push({ code: 'CRM_UNAVAILABLE', severity: 'critical', message: 'Nguồn CRM chưa có snapshot mới để đối soát.' });
    }
    const totals = new Map();
    const missingRevenue = new Set();
    for (const [source, start] of [['leads', 6], ['booked', 9], ['arrived', 12]]) {
        for (const row of crmSources?.[source]?.values || []) {
            if (!isCustomerRow(row)) continue;
            const key = calendarDay(source === 'leads' ? row[1] : source === 'booked' ? row[10] : row[10] || row[1]);
            if (!key) continue;
            if (!totals.has(key)) totals.set(key, Array(10).fill(0));
            const counts = totals.get(key);
            counts[start - 6 + serviceGroup(row[4])]++;
            if (source === 'arrived') {
                const revenue = numeric(row[22]) ?? numeric(row[21]);
                if (revenue === null) {
                    missingRevenue.add(key);
                    issues.push({ code: 'CRM_REVENUE_MISSING', severity: 'critical', dateKey: key,
                        message: 'Khách đến chưa có doanh số được ghi nhận.' });
                }
                else counts[9] += revenue;
            }
        }
    }
    const seen = new Set();
    for (const [index, row] of (marketing?.values || []).entries()) {
        const key = calendarDay(row[0]);
        if (!key) continue;
        if (seen.has(key)) issues.push({ code: 'DUPLICATE_DAY', severity: 'critical', dateKey: key,
            message: 'Nguồn Marketing có ngày trùng.' });
        seen.add(key);
        if (row.some(value => typeof value === 'string' && /^#(?:REF!|DIV\/0!|VALUE!|N\/A|ERROR!|NAME\?)/.test(value))) {
            issues.push({ code: 'SOURCE_FORMULA_ERROR', severity: 'critical', dateKey: key, row: index + 1,
                message: 'Nguồn Marketing có lỗi công thức.' });
        }
        if (numeric(row[3]) !== null && numeric(row[4]) !== null && numeric(row[5]) !== null
            && Math.abs(row[3] + row[4] - row[5]) > 1) {
            issues.push({ code: 'COST_MISMATCH', severity: 'critical', dateKey: key,
                message: 'Ads + phí quản lý không khớp tổng chi.' });
        }
        if (!crmSources) continue;
        const expected = totals.get(key) || Array(10).fill(0);
        for (let group = 0; group < 3; group++) {
            const actual = [0, 1, 2].map(service => numeric(row[6 + group * 3 + service]));
            const target = expected.slice(group * 3, group * 3 + 3);
            if (actual.some((value, i) => value === null || value !== target[i])) {
                issues.push({ code: 'SOURCE_COUNT_DIFFERENCE', severity: 'critical', dateKey: key,
                    source: ['leads', 'booked', 'arrived'][group],
                    message: `Số ${['lead', 'lịch hẹn', 'khách tới'][group]} Marketing chưa khớp CRM theo ngày và dịch vụ.` });
            }
        }
        if (!missingRevenue.has(key) && (numeric(row[15]) === null || Math.abs(row[15] - expected[9]) > 1)) issues.push({
            code: 'SOURCE_REVENUE_DIFFERENCE', severity: 'critical', dateKey: key,
            message: 'Doanh số Marketing chưa khớp CRM theo ngày khách đến.'
        });
    }
    for (const key of totals.keys()) if (!seen.has(key)) issues.push({ code: 'MARKETING_DAY_MISSING', severity: 'critical', dateKey: key,
        message: 'CRM có sự kiện ở ngày chưa có dòng Marketing.' });
    return { checkedAt, ok: !issues.some(issue => issue.severity === 'critical'), issues,
        crmSnapshotId: crm?.snapshotId || null, marketingSnapshotId: marketing?.metadata?.snapshotId || null };
}
