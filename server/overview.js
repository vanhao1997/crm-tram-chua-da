import { calendarDay, isCustomerRow } from './integrity.js';
import { appointmentSummary } from './appointment-summary.js';

const PERIODS = ['today', 'week', 'month', 'lastmonth', 'all', 'custom'];
const SOURCE_NAMES = ['leads', 'booked', 'arrived', 'marketing'];
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const shiftDay = (key, days) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const lastDay = month => `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`;
const dayCount = (start, end) => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;

export function comparisonPeriod(period) {
    if (!period.start || period.actualEnd < period.start) return null;
    const end = period.actualEnd;
    if (period.key === 'month' || period.key === 'lastmonth') {
        const previous = new Date(Date.UTC(Number(period.start.slice(0, 4)), Number(period.start.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
        const monthEnd = lastDay(previous);
        const matchingEnd = `${previous}-${end.slice(8, 10)}`;
        return { key: period.key, start: `${previous}-01`, end: period.key === 'lastmonth' || matchingEnd > monthEnd ? monthEnd : matchingEnd, timezone: period.timezone };
    }
    const offset = period.key === 'today' ? 1 : period.key === 'week' ? 7 : dayCount(period.start, end);
    return { key: period.key, start: shiftDay(period.start, -offset), end: shiftDay(end, -offset), timezone: period.timezone };
}

function invalidPeriod() {
    const error = new Error('Invalid overview period');
    error.code = 'INVALID_OVERVIEW_PERIOD';
    error.status = 400;
    return error;
}

function validKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function overviewPeriod(query = {}, reference = new Date(), timezone = 'Asia/Ho_Chi_Minh') {
    if (Object.keys(query).some(key => !['period', 'from', 'to'].includes(key))) throw invalidPeriod();
    const key = query.period ?? 'month';
    if (typeof key !== 'string' || !PERIODS.includes(key)) throw invalidPeriod();
    if (key !== 'custom' && ('from' in query || 'to' in query)) throw invalidPeriod();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(reference);
    const part = name => parts.find(item => item.type === name).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    let start = null, end = null;
    if (key === 'today') start = end = today;
    if (key === 'week') {
        start = shiftDay(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
        end = shiftDay(start, 6);
    }
    if (key === 'month') {
        start = `${today.slice(0, 7)}-01`;
        end = lastDay(today.slice(0, 7));
    }
    if (key === 'lastmonth') {
        const previous = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
        start = `${previous}-01`;
        end = lastDay(previous);
    }
    if (key === 'custom') {
        if (!validKey(query.from) || !validKey(query.to) || query.from > query.to) throw invalidPeriod();
        start = query.from;
        end = query.to;
    }
    return { key, start, end, actualEnd: end && end < today ? end : today, today, timezone };
}

function inWindow(day, period, actual = false) {
    return Boolean(day && (!period.start || day >= period.start) && (!(actual ? period.actualEnd : period.end) || day <= (actual ? period.actualEnd : period.end)));
}

function sum(rows, columns, { blanksAreZero = false } = {}) {
    if (!rows.length) return null;
    let total = 0;
    for (const row of rows) {
        for (const column of columns) {
            const value = numeric(row[column]);
            if (value === null) {
                if (blanksAreZero && (row[column] == null || row[column] === '')) continue;
                return null;
            }
            total += value;
        }
    }
    return total;
}

function marketingTotals(sources, sourceStatus, period) {
    const daily = (sources.marketing?.values || []).filter(row => inWindow(calendarDay(row[0]), period, true));
    const dates = daily.map(row => calendarDay(row[0]));
    const duplicateDays = new Set(dates).size !== dates.length;
    const rows = duplicateDays ? [] : daily;
    const marketing = {
        received: sum(rows, [2], { blanksAreZero: true }),
        ads: sum(rows, [3]), fee: sum(rows, [4]), cost: sum(rows, [5]),
        messages: sum(rows, [17]), data: sum(rows, [6, 7, 8]),
        appointments: sum(rows, [9, 10, 11]), arrived: sum(rows, [12, 13, 14]),
        revenue: sum(rows, [15])
    };
    if (['leads', 'booked', 'arrived'].some(name => !sourceStatus[name].available || sourceStatus[name].stale)) {
        for (const metric of ['data', 'appointments', 'arrived', 'revenue']) marketing[metric] = null;
    }
    marketing.balance = marketing.received !== null && marketing.cost !== null ? marketing.received - marketing.cost : null;
    const ratio = (value, denominator) => value !== null && denominator > 0 ? value / denominator : null;
    marketing.roas = ratio(marketing.revenue, marketing.ads);
    marketing.costRevenueRatio = marketing.cost !== null && marketing.cost >= 0
        ? ratio(marketing.cost, marketing.revenue) : null;
    marketing.costPerData = ratio(marketing.cost, marketing.data);
    marketing.costPerArrived = ratio(marketing.cost, marketing.arrived);
    const completeDays = !duplicateDays && period.start && daily.length === dayCount(period.start, period.actualEnd);
    return { marketing, duplicateDays, completeDays };
}

function marketingComparison(sources, sourceStatus, period, current) {
    const baseline = comparisonPeriod(period);
    const previous = baseline ? marketingTotals(sources, sourceStatus, { ...baseline, actualEnd: baseline.end }) : null;
    let reason = !baseline ? 'no_period' : null;
    if (baseline && Object.values(sourceStatus).some(source => !source.available || source.stale)) reason = 'source_unavailable';
    else if (baseline && (!current.completeDays || !previous.completeDays)) reason = 'incomplete_days';
    const compare = key => {
        const value = numeric(current.marketing[key]);
        const before = numeric(previous?.marketing[key]);
        const unavailable = reason || (value === null || before === null || value < 0 || before < 0 ? 'missing_metric' : null);
        if (unavailable) return { current: value, previous: reason ? null : before, change: null, direction: null, reason: unavailable };
        return { current: value, previous: before, change: before > 0 ? (value - before) / before : value === 0 ? 0 : null,
            direction: value > before ? 'up' : value < before ? 'down' : 'flat', reason: null };
    };
    return { period: baseline, costPerData: compare('costPerData'), costPerArrived: compare('costPerArrived') };
}

function selectedIssues(issues, period) {
    const grouped = new Map();
    for (const issue of issues) {
        if (issue.dateKey && !inWindow(issue.dateKey, period)) continue;
        if (!issue.dateKey && issue.monthKey) {
            const monthStart = `${issue.monthKey}-01`, monthEnd = lastDay(issue.monthKey);
            if ((period.start && monthEnd < period.start) || (period.end && monthStart > period.end)) continue;
        }
        const key = `${issue.code}:${issue.severity}`;
        if (!grouped.has(key)) grouped.set(key, {
            code: issue.code, severity: issue.severity, message: issue.message, count: 0
        });
        grouped.get(key).count += issue.count || 1;
    }
    return [...grouped.values()];
}

export function buildOverview(snapshot, period, reference = new Date()) {
    const sources = snapshot.sources || {};
    const sourceStatus = Object.fromEntries(SOURCE_NAMES.map(name => [name, {
        available: Boolean(sources[name]), stale: sources[name]?.metadata?.stale === true,
        fetchedAt: sources[name]?.metadata?.fetchedAt || null
    }]));
    const crmAvailable = ['leads', 'booked', 'arrived'].every(name => sourceStatus[name].available);
    const rowsFor = (name, column, actual) => (sources[name]?.values || []).filter(row => isCustomerRow(row) && inWindow(calendarDay(row[column] || (name === 'arrived' ? row[1] : null)), period, actual));
    const leads = rowsFor('leads', 1, true), appointments = rowsFor('booked', 10, false), visits = rowsFor('arrived', 10, true);
    let revenue = 0;
    for (const row of visits) {
        const amount = numeric(row[22]) ?? numeric(row[21]);
        if (amount === null) { revenue = null; break; }
        revenue += amount;
    }
    const derivedAppointments = (sources.booked?.values || []).reduce((count, row, index) => count + (sources.booked.identities?.[index]?.derived && inWindow(calendarDay(row[10]), period) ? 1 : 0), 0);
    const schedule = appointmentSummary(sources, period, reference);
    const crm = {
        leads: crmAvailable ? leads.length : null,
        appointments: crmAvailable ? appointments.length : null,
        pastAppointments: schedule.pastInPeriod,
        arrived: crmAvailable ? visits.length : null,
        revenue: crmAvailable ? revenue : null,
        derivedAppointments: crmAvailable ? derivedAppointments : null
    };
    const currentMarketing = marketingTotals(sources, sourceStatus, period);
    const { marketing, duplicateDays } = currentMarketing;
    marketing.comparison = marketingComparison(sources, sourceStatus, period, currentMarketing);
    const issues = (snapshot.integrity?.issues || []).flatMap(issue => issue.code === 'APPOINTMENTS_DERIVED'
        ? (derivedAppointments ? [{ ...issue, count: derivedAppointments }] : []) : [issue]);
    if (duplicateDays && !issues.some(issue => issue.code === 'DUPLICATE_DAY')) issues.push({ code: 'DUPLICATE_DAY', severity: 'critical', message: 'Nguồn Marketing có ngày trùng; tổng tài chính chưa xác định.' });
    for (const [source, status] of Object.entries(sourceStatus)) {
        if (!status.available) issues.push({ code: `${source === 'marketing' ? 'MARKETING' : 'CRM'}_UNAVAILABLE`, severity: 'critical', message: source === 'marketing' ? 'Không tải được nguồn Marketing.' : 'Không tải được nguồn CRM.' });
        else if (status.stale) issues.push({ code: 'STALE_SOURCE', severity: 'warning', message: 'Đang dùng dữ liệu gần nhất; chưa tải được nguồn mới.' });
    }
    const filtered = selectedIssues(issues, period);
    const times = Object.values(sourceStatus).map(source => Date.parse(source.fetchedAt)).filter(Number.isFinite);
    return { period, crm, marketing, schedule, metadata: {
        fetchedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
        stale: Object.values(sourceStatus).some(source => source.stale),
        partial: !crmAvailable || !sourceStatus.marketing.available,
        available: { crm: crmAvailable, marketing: sourceStatus.marketing.available },
        sources: sourceStatus,
        integrity: { ok: !filtered.some(issue => issue.severity === 'critical'), issues: filtered }
    } };
}
