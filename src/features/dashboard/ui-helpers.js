/**
 * Pure UI helpers shared by the CRM and Marketing pages.
 * These functions deliberately do not infer business status or merge records
 * without a valid, normalized phone number.
 */

export function toDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizePhone(value) {
    if (value === null || value === undefined) return null;
    let digits = String(value).replace(/\D/g, '');
    if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
    if (digits.length === 9) digits = `0${digits}`;
    if (!/^0\d{9,10}$/.test(digits)) return null;
    return digits;
}

export function phoneKey(record) {
    if (!record) return null;
    if (record.validPhone === false) return null;
    return normalizePhone(record.phone);
}

export function formatPhone(value) {
    const phone = normalizePhone(value);
    if (!phone) return value ? String(value) : 'Chưa có';
    return `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
}

export function dateOnly(value) {
    const date = toDate(value);
    if (!date) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function monthRange(reference = new Date()) {
    return {
        start: new Date(reference.getFullYear(), reference.getMonth(), 1),
        end: new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59, 999)
    };
}

export function isSameDay(a, b = new Date()) {
    const left = dateOnly(a);
    const right = dateOnly(b);
    return Boolean(left && right && left.getTime() === right.getTime());
}

export function getDateRange(filter, customStart, customEnd, reference = new Date()) {
    const today = dateOnly(reference);
    if (!today) return { start: null, end: null };
    if (filter === 'all') return { start: null, end: null };
    if (filter === 'today') return { start: today, end: new Date(today.getTime() + 86400000 - 1) };
    if (filter === 'week') {
        const mondayOffset = (today.getDay() + 6) % 7;
        const start = new Date(today);
        start.setDate(start.getDate() - mondayOffset);
        return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999) };
    }
    if (filter === 'month') return monthRange(reference);
    if (filter === 'lastmonth') {
        return {
            start: new Date(reference.getFullYear(), reference.getMonth() - 1, 1),
            end: new Date(reference.getFullYear(), reference.getMonth(), 0, 23, 59, 59, 999)
        };
    }
    if (filter === 'custom') {
        const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
        const end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : null;
        return { start, end };
    }
    if (filter === 'upcoming') return { start: today, end: null };
    return monthRange(reference);
}

export function inDateFilter(value, filter, customStart, customEnd, reference = new Date()) {
    const date = toDate(value);
    if (!date) return filter === 'all';
    const { start, end } = getDateRange(filter, customStart, customEnd, reference);
    if (filter === 'upcoming') return date >= start;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
}

function appointmentTime(record) {
    const date = toDate(record?.aptDate || record?.date);
    if (!date) return null;
    const rawTime = String(record?.time || '').trim();
    const match = rawTime.match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})$/);
    const result = new Date(date);
    if (match && hasConfirmedTime(record)) {
        result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    } else {
        result.setHours(23, 59, 59, 999);
    }
    return result;
}

export function hasConfirmedTime(record) {
    const m = String(record?.time || '').trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})$/);
    return Boolean(m && Number(m[1]) < 24 && Number(m[2]) < 60);
}

export function isUpcomingAppointment(record, reference = new Date()) {
    const date = dateOnly(record?.aptDate || record?.date);
    const today = dateOnly(reference);
    if (!date || !today) return false;
    if (!hasConfirmedTime(record)) return date >= today;
    return appointmentTime(record) >= reference;
}

export function sortAppointments(records, reference = new Date()) {
    const now = reference.getTime();
    const todayStart = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
    return [...(records || [])].sort((a, b) => {
        const aDate = toDate(a?.aptDate || a?.date);
        const bDate = toDate(b?.aptDate || b?.date);
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        const aTime = appointmentTime(a)?.getTime() ?? aDate.getTime();
        const bTime = appointmentTime(b)?.getTime() ?? bDate.getTime();
        const aToday = dateOnly(aDate)?.getTime() === todayStart;
        const bToday = dateOnly(bDate)?.getTime() === todayStart;
        const aFuture = aToday ? aTime >= now : aDate.getTime() > todayStart;
        const bFuture = bToday ? bTime >= now : bDate.getTime() > todayStart;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        if (aFuture) return aTime - bTime;
        return bTime - aTime;
    });
}

export function latestRecordDate(record) {
    return toDate(record?.aptDate || record?.date);
}

export function getDisplayStatus(record) {
    return String(record?.status || '').trim() || 'Chưa xác định';
}

export function deriveCustomers(data) {
    const groups = new Map();
    const sources = [
        ['lead', data?.leads || [], 'date'],
        ['booked', data?.booked || [], 'aptDate'],
        ['arrived', data?.arrived || [], 'aptDate']
    ];
    let unlinkedIndex = 0;
    for (const [source, records, dateField] of sources) {
        records.forEach((record, index) => {
            const key = phoneKey(record) || `unlinked:${source}:${record?.sourceRow || index}:${unlinkedIndex++}`;
            let customer = groups.get(key);
            if (!customer) {
                customer = {
                    id: key,
                    name: record?.name || 'Chưa có tên',
                    phone: phoneKey(record),
                    records: [],
                    services: new Set(),
                    sources: new Set(),
                    revenue: null,
                    latest: null,
                    status: 'Chưa xác định'
                };
                groups.set(key, customer);
            }
            const date = toDate(record?.[dateField] || record?.aptDate || record?.date);
            const event = { ...record, source, date };
            customer.records.push(event);
            customer.sources.add(source);
            if (record?.service) customer.services.add(String(record.service).trim());
            const revenue = Number(record?.revenue);
            if (source === 'arrived' && record.revenue != null && record.revenue !== '' && Number.isFinite(revenue)) customer.revenue = (customer.revenue ?? 0) + revenue;
            if (!customer.latest || (date && (!customer.latest.date || date > customer.latest.date))) {
                customer.latest = event;
                customer.name = record?.name || customer.name;
                customer.status = getDisplayStatus(record);
            }
        });
    }
    return [...groups.values()]
        .map(customer => ({
            ...customer,
            service: [...customer.services][0] || 'Chưa xác định',
            source: [...customer.sources].join(', '),
            latestDate: customer.latest?.date || null,
            records: customer.records.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
        }))
        .sort((a, b) => (b.latestDate?.getTime() || 0) - (a.latestDate?.getTime() || 0));
}

export function searchRecords(records, query) {
    const needle = String(query || '').trim().toLocaleLowerCase('vi-VN');
    if (!needle) return records || [];
    return (records || []).filter(record => {
        const haystack = [
            record?.name,
            record?.phone,
            record?.service,
            record?.source,
            record?.status
        ].filter(Boolean).join(' ').toLocaleLowerCase('vi-VN');
        return haystack.includes(needle);
    });
}
