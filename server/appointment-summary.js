import { calendarDay, isCustomerRow, normalizePhone } from './integrity.js';

const LIMIT = 20;
const shiftDay = (key, days) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const text = (value, length = 100) => String(value ?? '').trim().slice(0, length);
const validPhone = value => /^0\d{9,10}$/.test(normalizePhone(value));
const statusKind = value => {
    const status = text(value).toLocaleLowerCase('vi-VN');
    if (/hủy|huỷ/.test(status)) return 'canceled';
    if (/dời/.test(status)) return 'rescheduled';
    if (/đã đến|đến và về/.test(status)) return 'completed';
    return 'scheduled';
};

function confirmedTime(value) {
    const raw = text(value, 40);
    const match = raw.match(/^(\d{1,2}):([0-5]\d)(?::00)?$/) || raw.match(/^(\d{1,2})h(\d{1,2})?$/i);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2] || 0);
    if (hour > 23 || minute > 59) return null;
    // Bare 1h-7h is ambiguous in these sources; do not invent AM/PM.
    if (/h/i.test(raw) && hour >= 1 && hour < 8) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function appointmentSummary(sources, period, reference = new Date()) {
    const today = period.today;
    const recentStart = shiftDay(today, -6);
    const available = Boolean(sources.booked);
    const stale = ['booked', 'arrived'].some(source => sources[source]?.metadata?.stale === true);
    const metadata = { asOf: reference.toISOString(), timezone: period.timezone, available, stale,
        recentStart, recentEnd: today, limit: LIMIT };
    const empty = () => ({ total: null, items: [], omitted: 0 });
    if (!available) return { ...metadata, pastInPeriod: null, upcoming: empty(), recentPast: empty() };
    const arrivedIds = new Set();
    const arrivedEvents = new Set();
    for (const [index, row] of (sources.arrived?.values || []).entries()) {
        if (!isCustomerRow(row)) continue;
        const appointmentId = sources.arrived?.identities?.[index]?.appointmentId;
        if (appointmentId) arrivedIds.add(appointmentId);
        const day = calendarDay(row[10] || row[1]);
        if (day && validPhone(row[3])) arrivedEvents.add(`${normalizePhone(row[3])}:${day}`);
    }
    const upcoming = [], recentPast = [];
    let pastInPeriod = 0;
    for (const [index, row] of sources.booked.values.entries()) {
        if (!isCustomerRow(row)) continue;
        const day = calendarDay(row[10]);
        if (!day) continue;
        const time = confirmedTime(row[9]);
        const when = time ? Date.parse(`${day}T${time}:00+07:00`) : null;
        const past = day < today || (day === today && when !== null && when < reference.getTime());
        if (past && (!period.start || day >= period.start) && (!period.end || day <= period.end)) pastInPeriod++;
        if (day < recentStart && past) continue;
        const identity = sources.booked.identities?.[index];
        const completed = (identity?.appointmentId && arrivedIds.has(identity.appointmentId))
            || (validPhone(row[3]) && arrivedEvents.has(`${normalizePhone(row[3])}:${day}`));
        const kind = completed ? 'completed' : statusKind(row[8]);
        const item = { name: text(row[2]) || 'Chưa có tên', service: text(row[4]) || 'Chưa ghi dịch vụ',
            date: day, time: time || text(row[9], 40) || 'Chưa rõ giờ', timeConfirmed: time !== null,
            status: text(row[8], 40) || 'Chưa rõ trạng thái',
            kind, visitRecorded: Boolean(completed), derived: identity?.derived === true };
        if (past) recentPast.push(item);
        else if (kind === 'scheduled') upcoming.push(item);
    }
    const chronological = (a, b) => a.date.localeCompare(b.date) ||
        (a.timeConfirmed ? a.time : '24:00').localeCompare(b.timeConfirmed ? b.time : '24:00');
    upcoming.sort(chronological);
    recentPast.sort((a, b) => chronological(b, a));
    const compact = items => ({ total: items.length, items: items.slice(0, LIMIT), omitted: Math.max(0, items.length - LIMIT) });
    return { ...metadata, pastInPeriod, upcoming: compact(upcoming), recentPast: compact(recentPast) };
}
