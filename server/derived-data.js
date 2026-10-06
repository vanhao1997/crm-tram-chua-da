import crypto from 'node:crypto';
import { calendarDay, isCustomerRow, isConfirmedBooking, normalizePhone, serviceGroup } from './integrity.js';

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const eventKey = row => `${normalizePhone(row[3])}|${calendarDay(row[10])}`;

// Read-only event completion: an explicit booking with a valid date is evidence,
// but does not establish that a customer arrived or paid.
export function completeAppointments(sources) {
    const booked = sources.booked;
    const values = booked.values.map(row => [...row]);
    const identities = Array.from({ length: values.length }, (_, index) => booked.identities?.[index] || null);
    const events = new Set(values.filter(isCustomerRow).map(eventKey));
    const knownLeads = new Set(values.filter(isCustomerRow)
        .map(row => `${normalizePhone(row[3])}|${calendarDay(row[1])}`));
    let derivedCount = 0;
    for (const [index, row] of sources.leads.values.entries()) {
        const phone = normalizePhone(row[3]);
        const day = calendarDay(row[10]);
        const leadDay = calendarDay(row[1]);
        if (!isCustomerRow(row) || !phone || !leadDay || !day || !isConfirmedBooking(row[8])) continue;
        if (events.has(eventKey(row)) || knownLeads.has(`${phone}|${leadDay}`)) continue;
        const recordId = sources.leads.identities?.[index]?.recordId || null;
        values.push([...row]);
        identities.push({ recordId: recordId ? `booking:${recordId}` : `derived:${crypto.createHash('sha256')
            .update(`${sources.leads.metadata.workspaceId}|${phone}|${leadDay}|${day}`).digest('hex').slice(0, 24)}`,
            leadId: recordId, appointmentId: null, visitId: null, sourceRow: index + 1,
            source: 'leads', derived: true, persisted: false });
        events.add(eventKey(row));
        derivedCount++;
    }
    return { ...booked, values, identities, metadata: { ...booked.metadata,
        rowCount: values.length, derivedCount,
        warnings: [...(booked.metadata.warnings || []), ...(derivedCount ? ['appointments_derived_from_confirmed_leads'] : [])] } };
}

export function dailyCrmMetrics(crm) {
    const totals = new Map();
    const missingRevenue = new Set();
    for (const [source, offset] of [['leads', 0], ['booked', 3], ['arrived', 6]]) {
        for (const row of crm.sources[source].values) {
            if (!isCustomerRow(row)) continue;
            const day = calendarDay(source === 'leads' ? row[1] : source === 'booked' ? row[10] : row[10] || row[1]);
            if (!day) continue;
            if (!totals.has(day)) totals.set(day, Array(11).fill(0));
            const metric = totals.get(day);
            metric[offset + serviceGroup(row[4])]++;
            if (source === 'arrived') {
                const revenue = typeof row[22] === 'number' ? row[22] : typeof row[21] === 'number' ? row[21] : null;
                if (revenue === null || !Number.isFinite(revenue)) missingRevenue.add(day);
                else metric[9] += revenue;
            }
            if (source === 'leads' && /^(sai số|ở xa|không hoàn thành|từ chối)$/i.test(String(row[8] || '').trim())) metric[10]++;
        }
    }
    for (const day of missingRevenue) totals.get(day)[9] = null;
    return totals;
}

export function deriveMarketing(crm, marketing, checkedAt) {
    const totals = dailyCrmMetrics(crm);
    const values = marketing.values.map(row => [...row]);
    const correctedIssues = [];
    for (const [index, row] of values.entries()) {
        const day = calendarDay(row[0]);
        if (!day) continue;
        const metrics = totals.get(day) || Array(11).fill(0);
        const changed = [];
        for (let col = 6; col <= 16; col++) {
            if (row[col] !== metrics[col - 6]) changed.push(col + 1);
            row[col] = metrics[col - 6];
        }
        if (changed.length) correctedIssues.push({ code: 'SHEET_METRICS_RECALCULATED', severity: 'warning',
            dateKey: day, row: index + 1, corrected: true, columns: changed,
            message: 'KPI trên web tính từ CRM; công thức Sheets chưa khớp nguồn.' });
        if (typeof row[3] === 'number' && typeof row[4] === 'number') {
            const cost = row[3] + row[4];
            if (typeof row[5] !== 'number' || Math.abs(row[5] - cost) > 1) correctedIssues.push({
                code: 'SHEET_COST_RECALCULATED', severity: 'warning', dateKey: day, row: index + 1, corrected: true,
                message: 'Tổng chi trên web được tính lại từ Ads và phí quản lý.'
            });
            row[5] = cost;
        }
    }
    const daily = values.filter(row => calendarDay(row[0]));
    const sum = (rows, col) => rows.reduce((total, row) => total + number(row[col]), 0);
    const recalculate = (row, rows) => {
        for (const col of [2, 3, 4, 5, 15, 16, 17]) row[col] = sum(rows, col);
        if (rows.some(item => item[15] === null)) row[15] = null;
        row[1] = row[2] - row[5];
        for (const offset of [6, 9, 12]) row[offset] = [0, 1, 2].reduce((total, i) => total + sum(rows, offset + i), 0);
        for (const [col, numerator, denominator] of [[18,5,17],[19,5,6],[20,6,17],[21,5,9],[22,9,6],[23,5,12],[24,12,9],[25,5,15]]) {
            row[col] = row[denominator] > 0 ? row[numerator] / row[denominator] : '';
        }
    };
    for (let index = 4; index < values.length; index++) {
        if (!/^THÁNG/i.test(String(values[index][0] || ''))) continue;
        let end = index + 1;
        while (end < values.length && !/^THÁNG/i.test(String(values[end][0] || ''))) end++;
        recalculate(values[index], values.slice(index + 1, end).filter(row => calendarDay(row[0])));
    }
    if (values[1]) recalculate(values[1], daily);
    if (values[3]) recalculate(values[3], daily);
    if (values[4]?.[0] === 'THÁNG 2') values[4][0] = 'THÁNG 2-3';
    return { ...marketing, values, metadata: { ...marketing.metadata,
        calculationSource: 'fresh_crm_events', calculatedAt: checkedAt,
        derivedAppointmentCount: crm.sources.booked.metadata.derivedCount || 0,
        correctedIssues } };
}
