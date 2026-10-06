import test from 'node:test';
import assert from 'node:assert/strict';
import { completeAppointments, dailyCrmMetrics, deriveMarketing } from './derived-data.js';

function crmRow({
    dataDate = '',
    appointmentDate = '',
    name = 'Khach A',
    phone = '0901234567',
    service = 'Nâng cơ',
    status = '',
    revenueV,
    revenueW
} = {}) {
    const row = Array(24).fill('');
    row[1] = dataDate;
    row[2] = name;
    row[3] = phone;
    row[4] = service;
    row[8] = status;
    row[10] = appointmentDate;
    if (revenueV !== undefined) row[21] = revenueV;
    if (revenueW !== undefined) row[22] = revenueW;
    return row;
}

function source(values, metadata = {}) {
    return {
        values,
        identities: values.map((row, index) => index === 0 ? null : { recordId: `rec-${index}`, sourceRow: index + 1 }),
        metadata: { workspaceId: 'workspace-1', warnings: [], ...metadata }
    };
}

function metric(totals, day) {
    return totals.get(day) || Array(11).fill(0);
}

function marketingRow(date, { received = 0, ads = 0, fee = 0, total = 0, revenue = 0, messages = 0 } = {}) {
    const row = Array(26).fill(0);
    row[0] = date;
    row[2] = received;
    row[3] = ads;
    row[4] = fee;
    row[5] = total;
    row[15] = revenue;
    row[17] = messages;
    return row;
}

test('completeAppointments dedups moved bookings and does not invent arrivals or revenue', () => {
    const sources = {
        leads: source([
            ['header'],
            crmRow({ dataDate: '01/10/2026', appointmentDate: '04/10/2026', phone: '0900000001', status: 'Đặt Hẹn' }),
            crmRow({ dataDate: '02/10/2026', appointmentDate: '05/10/2026', phone: '0900000002', status: 'Đặt Hẹn' }),
            crmRow({ dataDate: '03/10/2026', appointmentDate: '06/10/2026', phone: '0900000003', status: 'Đặt Hẹn' }),
            crmRow({ dataDate: '22/09/2026', appointmentDate: '11/10/2026', phone: '0900000004', status: 'Đặt Hẹn' }),
            crmRow({ dataDate: '03/10/2026', appointmentDate: '06/10/2026', phone: '0900000005', status: 'Không đặt hẹn' })
        ]),
        booked: source([
            ['header'],
            crmRow({ dataDate: '02/10/2026', appointmentDate: '05/10/2026', phone: '0900000002' }),
            crmRow({ dataDate: '03/10/2026', appointmentDate: '07/10/2026', phone: '0900000003' })
        ]),
        arrived: source([['header']])
    };

    const completed = completeAppointments(sources);
    const totals = dailyCrmMetrics({ sources: { ...sources, booked: completed } });

    assert.equal(completed.metadata.derivedCount, 2);
    assert.equal(completed.values.length, 5);
    assert.equal(completed.identities[3].source, 'leads');
    assert.equal(completed.identities[3].persisted, false);
    assert.equal(completed.identities[4].sourceRow, 5);
    assert.equal(metric(totals, '2026-10-04')[3], 1);
    assert.equal(metric(totals, '2026-10-04')[6], 0);
    assert.equal(metric(totals, '2026-10-04')[9], 0);
    assert.equal(metric(totals, '2026-10-06')[3], 0);
    assert.equal(metric(totals, '2026-10-11')[3], 1);
});

test('dailyCrmMetrics uses booking date K, visit date K fallback B, and W revenue before V', () => {
    const totals = dailyCrmMetrics({
        sources: {
            leads: source([['header']]),
            booked: source([['header'], crmRow({ dataDate: '01/10/2026', appointmentDate: '09/10/2026', service: 'Mũi chỉ' })]),
            arrived: source([
                ['header'],
                crmRow({ dataDate: '02/10/2026', appointmentDate: '', service: 'Khác', revenueV: 100, revenueW: 900 }),
                crmRow({ dataDate: '03/10/2026', appointmentDate: '10/10/2026', service: 'Nâng cơ', revenueV: 700, revenueW: '' })
            ])
        }
    });

    assert.equal(metric(totals, '2026-10-01')[4], 0);
    assert.equal(metric(totals, '2026-10-09')[4], 1);
    assert.equal(metric(totals, '2026-10-02')[8], 1);
    assert.equal(metric(totals, '2026-10-02')[9], 900);
    assert.equal(metric(totals, '2026-10-10')[6], 1);
    assert.equal(metric(totals, '2026-10-10')[9], 700);
});

test('deriveMarketing recalculates daily metrics and subtotals without counting next subtotal rows', () => {
    const crm = {
        sources: {
            leads: source([
                ['header'],
                crmRow({ dataDate: '01/10/2026', service: 'Nâng cơ' }),
                crmRow({ dataDate: '02/10/2026', service: 'Mũi chỉ', status: 'Sai số' })
            ]),
            booked: source([
                ['header'],
                crmRow({ appointmentDate: '01/10/2026', service: 'Nâng cơ' }),
                crmRow({ appointmentDate: '02/10/2026', service: 'Khác' })
            ], { derivedCount: 1 }),
            arrived: source([
                ['header'],
                crmRow({ appointmentDate: '01/10/2026', service: 'Nâng cơ', revenueW: 1000 }),
                crmRow({ appointmentDate: '02/10/2026', service: 'Khác', revenueV: 200, revenueW: '' })
            ])
        }
    };
    const marketing = {
        values: [
            ['header'],
            marketingRow('TỔNG', { ads: 9999, total: 9999 }),
            ['blank'],
            marketingRow('TỔNG NĂM', { ads: 9999, total: 9999 }),
            marketingRow('THÁNG 10', { ads: 9999, total: 9999 }),
            marketingRow('01/10/2026', { received: 1000, ads: 100, fee: 10, total: 0, messages: 5 }),
            marketingRow('02/10/2026', { received: 200, ads: 50, fee: 5, total: 0, messages: 7 }),
            marketingRow('THÁNG 11', { ads: 9999, total: 9999 }),
            marketingRow('01/11/2026', { received: 300, ads: 300, fee: 30, total: 0, messages: 11 })
        ],
        metadata: { source: 'marketing' }
    };

    const result = deriveMarketing(crm, marketing, '2026-10-06T00:00:00.000Z');
    const day1 = result.values[5];
    const day2 = result.values[6];
    const october = result.values[4];
    const global = result.values[1];

    assert.deepEqual(day1.slice(6, 17), [1, 0, 0, 1, 0, 0, 1, 0, 0, 1000, 0]);
    assert.deepEqual(day2.slice(6, 17), [0, 1, 0, 0, 0, 1, 0, 0, 1, 200, 1]);
    assert.equal(day1[5], 110);
    assert.equal(day2[5], 55);
    assert.equal(october[3], 150);
    assert.equal(october[5], 165);
    assert.equal(october[15], 1200);
    assert.equal(october[16], 1);
    assert.equal(october[17], 12);
    assert.equal(global[3], 450);
    assert.equal(global[5], 495);
    assert.equal(result.metadata.derivedAppointmentCount, 1);
    assert.ok(result.metadata.correctedIssues.some(issue => issue.dateKey === '2026-10-01' && issue.columns.includes(7)));
    assert.ok(result.metadata.correctedIssues.some(issue => issue.dateKey === '2026-10-02' && issue.columns.includes(16)));
});

test('deriveMarketing preserves unknown visit revenue as null in daily and subtotal totals', () => {
    const crm = {
        sources: {
            leads: source([['header']]),
            booked: source([['header']]),
            arrived: source([['header'], crmRow({ appointmentDate: '01/10/2026', service: 'Nâng cơ' })])
        }
    };
    const marketing = {
        values: [
            ['header'],
            marketingRow('TỔNG'),
            ['blank'],
            marketingRow('TỔNG NĂM'),
            marketingRow('THÁNG 10'),
            marketingRow('01/10/2026', { revenue: 0 })
        ],
        metadata: { source: 'marketing' }
    };

    const result = deriveMarketing(crm, marketing, '2026-10-06T00:00:00.000Z');

    assert.equal(metric(dailyCrmMetrics(crm), '2026-10-01')[9], null);
    assert.equal(result.values[5][15], null);
    assert.equal(result.values[4][15], null);
    assert.equal(result.values[3][15], null);
    assert.equal(result.values[1][15], null);
    assert.ok(result.metadata.correctedIssues.some(issue => issue.dateKey === '2026-10-01' && issue.columns.includes(16)));
});
