import { dateKey } from '../../core/analytics/budget-intelligence.js';

/**
 * Pure UI helpers shared by the CRM and Marketing pages.
 * These functions deliberately do not infer business status or merge records
 * without a valid, normalized phone number.
 */

const ONE_DAY = 86400000;
const businessBoundary = (key, end = false) => key ? new Date(`${key}T${end ? '23:59:59.999' : '00:00:00.000'}+07:00`) : null;
const shiftDayKey = (key, days) => new Date(new Date(`${key}T12:00:00Z`).getTime() + days * ONE_DAY).toISOString().slice(0, 10);
const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
const shiftMonth = (month, offset) => {
    const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function toDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizePhone(value) {
    if (value === null || value === undefined) return null;
    let digits = String(value).replace(/\D/g, '');
    if (digits.startsWith('84') && digits.length >= 11) digits = `0${digits.slice(2)}`;
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
    return businessBoundary(dateKey(value));
}

export function monthRange(reference = new Date()) {
    const month = dateKey(reference)?.slice(0, 7);
    if (!month) return { start: null, end: null };
    return {
        start: businessBoundary(`${month}-01`),
        end: businessBoundary(`${month}-${String(monthEnd(month)).padStart(2, '0')}`, true)
    };
}

export function isSameDay(a, b = new Date()) {
    const left = dateKey(a);
    const right = dateKey(b);
    return Boolean(left && right && left === right);
}

export function getDateRange(filter, customStart, customEnd, reference = new Date()) {
    const todayKey = dateKey(reference);
    const today = businessBoundary(todayKey);
    if (!todayKey || !today) return { start: null, end: null };
    if (filter === 'all') return { start: null, end: null };
    if (filter === 'today') return { start: today, end: businessBoundary(todayKey, true) };
    if (filter === 'week') {
        const mondayOffset = (new Date(`${todayKey}T12:00:00Z`).getUTCDay() + 6) % 7;
        const startKey = shiftDayKey(todayKey, -mondayOffset);
        return { start: businessBoundary(startKey), end: businessBoundary(shiftDayKey(startKey, 6), true) };
    }
    if (filter === 'month') return monthRange(reference);
    if (filter === 'lastmonth') {
        const previous = shiftMonth(todayKey.slice(0, 7), -1);
        return {
            start: businessBoundary(`${previous}-01`),
            end: businessBoundary(`${previous}-${String(monthEnd(previous)).padStart(2, '0')}`, true)
        };
    }
    if (filter === 'custom') {
        const startKey = customStart ? dateKey(customStart) : null;
        const endKey = customEnd ? dateKey(customEnd) : null;
        const start = startKey ? businessBoundary(startKey) : null;
        const end = endKey ? businessBoundary(endKey, true) : null;
        return { start, end };
    }
    if (filter === 'upcoming') return { start: today, end: null };
    return monthRange(reference);
}

export function inDateFilter(value, filter, customStart, customEnd, reference = new Date()) {
    const date = dateOnly(value);
    if (!date) return filter === 'all';
    const { start, end } = getDateRange(filter, customStart, customEnd, reference);
    if (filter === 'upcoming') return date >= start;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
}

function appointmentTime(record) {
    const key = dateKey(record?.aptDate || record?.date);
    if (!key) return null;
    const rawTime = String(record?.time || '').trim();
    const match = rawTime.match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})$/);
    if (match && hasConfirmedTime(record)) {
        return new Date(`${key}T${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}:00.000+07:00`);
    }
    return businessBoundary(key, true);
}

export function hasConfirmedTime(record) {
    const m = String(record?.time || '').trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})$/);
    return Boolean(m && Number(m[1]) < 24 && Number(m[2]) < 60);
}

export function isUpcomingAppointment(record, reference = new Date()) {
    const key = dateKey(record?.aptDate || record?.date);
    const todayKey = dateKey(reference);
    if (!key || !todayKey) return false;
    if (!hasConfirmedTime(record)) return key >= todayKey;
    return appointmentTime(record) >= reference;
}

export function sortAppointments(records, reference = new Date()) {
    const now = reference.getTime();
    const todayKey = dateKey(reference);
    return [...(records || [])].sort((a, b) => {
        const aKey = dateKey(a?.aptDate || a?.date);
        const bKey = dateKey(b?.aptDate || b?.date);
        if (!aKey && !bKey) return 0;
        if (!aKey) return 1;
        if (!bKey) return -1;
        const aTime = appointmentTime(a)?.getTime() ?? businessBoundary(aKey)?.getTime() ?? 0;
        const bTime = appointmentTime(b)?.getTime() ?? businessBoundary(bKey)?.getTime() ?? 0;
        const aToday = aKey === todayKey;
        const bToday = bKey === todayKey;
        const aFuture = aToday ? aTime >= now : aKey > todayKey;
        const bFuture = bToday ? bTime >= now : bKey > todayKey;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        if (aFuture) return aTime - bTime;
        return bTime - aTime;
    });
}

export function latestRecordDate(record) {
    return toDate(record?.aptDate || record?.date);
}

export function eventDate(record) {
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
            const date = source === 'arrived' ? eventDate(record) : toDate(record?.[dateField] || record?.aptDate || record?.date);
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
