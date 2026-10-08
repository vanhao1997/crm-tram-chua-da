import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, comparisonPeriod, overviewPeriod } from './overview.js';

const reference = new Date('2026-10-05T18:30:00Z');
const period = overviewPeriod({}, reference);
function customer(leadDate, appointmentDate, revenue) {
    const row = Array(26).fill('');
    row[1] = leadDate; row[2] = 'Private customer'; row[3] = '0901234567'; row[10] = appointmentDate;
    if (revenue !== undefined) row[22] = revenue;
    return row;
}
function daily(date, received, ads, fee, revenue = 0) {
    const row = Array(26).fill(0);
    row[0] = date; row[2] = received; row[3] = ads; row[4] = fee; row[5] = ads + fee; row[6] = 2; row[9] = 1; row[15] = revenue; row[17] = 3;
    return row;
}
function snapshot() {
    const source = values => ({ values, metadata: { fetchedAt: reference.toISOString(), stale: false } });
    return { sources: {
        leads: source([customer('01/10/2026', '11/10/2026'), customer('22/09/2026', '11/10/2026'), customer('11/10/2026', '11/10/2026')]),
        booked: { ...source([customer('22/09/2026', '11/10/2026'), customer('01/10/2026', '05/10/2026')]), identities: [{ derived: true }, null] },
        arrived: source([customer('01/09/2026', '02/10/2026', 1234.5)]),
        marketing: source([daily('THÁNG 10', 999999, 888888, 1), daily('01/10/2026', '', 100.5, 5), daily('02/10/2026', 500, 200, 10, 1234.5), daily('11/10/2026', 900, 1000, 50)])
    }, integrity: { issues: [
        { code: 'CRM_REVENUE_MISSING', dateKey: '2026-06-24', severity: 'critical', message: 'Old missing revenue', row: 9 },
        { code: 'APPOINTMENTS_DERIVED', severity: 'warning', message: 'Derived bookings', count: 17 },
        { code: 'SHEET_METRICS_RECALCULATED', monthKey: '2026-10', severity: 'warning', message: 'Recalculated', count: 6 }
    ] } };
}

test('overview periods use Vietnam calendar boundaries and validate custom ranges before reading', () => {
    assert.equal(period.today, '2026-10-06');
    assert.equal(period.start, '2026-10-01');
    assert.equal(period.end, '2026-10-31');
    assert.equal(period.actualEnd, '2026-10-06');
    assert.equal(overviewPeriod({ period: 'lastmonth' }, reference).end, '2026-09-30');
    assert.equal(overviewPeriod({ period: 'week' }, reference).start, '2026-10-05');
    assert.equal(overviewPeriod({ period: 'week' }, reference).end, '2026-10-11');
    assert.equal(overviewPeriod({ period: 'month' }, new Date('2024-02-05T00:00:00Z')).end, '2024-02-29');
    for (const query of [{ period: 'other' }, { period: ['month'] }, { period: 'custom', from: '2026-02-30', to: '2026-03-01' }, { period: 'custom', from: '2026-10-06', to: '2026-10-05' }, { period: 'month', from: '2026-10-01' }, { spreadsheetId: 'foreign' }]) {
        assert.throws(() => overviewPeriod(query, reference), { code: 'INVALID_OVERVIEW_PERIOD' });
    }
});

test('overview preserves event dates and money, excludes future actuals and subtotals, and limits appointment details', () => {
    const result = buildOverview(snapshot(), period, reference);
    assert.deepEqual(result.crm, { leads: 1, appointments: 2, pastAppointments: 1, arrived: 1, revenue: 1234.5, derivedAppointments: 1 });
    assert.equal(result.marketing.received, 500);
    assert.equal(result.marketing.cost, 315.5);
    assert.equal(result.marketing.balance, 184.5);
    assert.equal(result.marketing.messages, 6);
    assert.equal(result.marketing.data, 4);
    assert.equal(result.marketing.roas, 1234.5 / 300.5);
    assert.equal(result.marketing.costRevenueRatio, 315.5 / 1234.5);
    assert.equal(result.metadata.integrity.ok, true);
    assert.deepEqual(result.metadata.integrity.issues.map(issue => [issue.code, issue.count]), [['APPOINTMENTS_DERIVED', 1], ['SHEET_METRICS_RECALCULATED', 6]]);
    assert.equal(result.schedule.recentPast.total, 1);
    assert.equal(result.schedule.upcoming.total, 1);
    assert.doesNotMatch(JSON.stringify(result), /0901234567|sourceRow|identities|values|Old missing revenue/);
    assert.doesNotMatch(JSON.stringify({ crm: result.crm, marketing: result.marketing }), /Private customer/);
});

test('missing revenue hides totals while recorded zero remains zero and legacy V remains valid', () => {
    const input = snapshot();
    input.sources.arrived.values[0][22] = '';
    input.sources.marketing.values[2][15] = null;
    assert.equal(buildOverview(input, period).crm.revenue, null);
    assert.equal(buildOverview(input, period).marketing.revenue, null);
    input.sources.arrived.values[0][21] = 0;
    input.sources.marketing.values[2][15] = 0;
    assert.equal(buildOverview(input, period).crm.revenue, 0);
    assert.equal(buildOverview(input, period).marketing.revenue, 0);
    input.sources.arrived.values[0][21] = 12.5;
    assert.equal(buildOverview(input, period).crm.revenue, 12.5);
});

test('CRM and marketing failures stay independently unavailable rather than trusted zero', () => {
    const input = snapshot();
    delete input.sources.marketing;
    let result = buildOverview(input, period);
    assert.equal(result.crm.leads, 1);
    assert.equal(result.marketing.cost, null);
    assert.equal(result.metadata.partial, true);
    assert.equal(result.metadata.integrity.ok, false);
    for (const source of ['leads', 'booked', 'arrived']) delete input.sources[source];
    input.sources.marketing = snapshot().sources.marketing;
    result = buildOverview(input, period);
    assert.equal(result.crm.leads, null);
    assert.equal(result.marketing.cost, 315.5);
    assert.equal(result.marketing.data, null);
    assert.equal(result.marketing.revenue, null);
    assert.equal(result.marketing.roas, null);
    assert.equal(result.marketing.costRevenueRatio, null);
    assert.equal(result.metadata.available.crm, false);
});

test('cost / revenue includes management fees and is unavailable for zero, missing or stale inputs', () => {
    const input = snapshot();
    const row = daily('01/10/2026', 0, 270, 30, 1000);
    input.sources.marketing.values = [row];
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, 0.3);
    row[5] = 0;
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, 0);
    row[5] = 300;
    row[15] = 0;
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, null);
    row[15] = null;
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, null);
    row[15] = 1000;
    row[5] = null;
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, null);
    row[5] = 300;
    input.sources.arrived.metadata.stale = true;
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, null);
    input.sources.arrived.metadata.stale = false;
    row[5] = -300;
    assert.equal(buildOverview(input, period).marketing.costRevenueRatio, null);
});

test('duplicate financial days cannot double-count totals and stale snapshots remain labeled', () => {
    const input = snapshot();
    input.sources.marketing.values.push(input.sources.marketing.values[1]);
    input.sources.leads.metadata.stale = true;
    const result = buildOverview(input, period);
    assert.equal(result.marketing.received, null);
    assert.equal(result.marketing.cost, null);
    assert.equal(result.metadata.stale, true);
    assert.ok(result.metadata.integrity.issues.some(issue => issue.code === 'DUPLICATE_DAY'));
    assert.ok(result.metadata.integrity.issues.some(issue => issue.code === 'STALE_SOURCE'));
});

test('custom windows compact only source discrepancies inside the selected dates', () => {
    const input = snapshot();
    input.integrity.issues = [
        { code: 'SHEET_METRICS_RECALCULATED', severity: 'warning', dateKey: '2026-10-01', message: 'Recalculated', row: 1 },
        { code: 'SHEET_METRICS_RECALCULATED', severity: 'warning', dateKey: '2026-10-02', message: 'Recalculated', row: 2 },
        { code: 'SHEET_METRICS_RECALCULATED', severity: 'warning', dateKey: '2026-10-03', message: 'Recalculated', row: 3 }
    ];
    const result = buildOverview(input, overviewPeriod({ period: 'custom', from: '2026-10-02', to: '2026-10-02' }, reference));
    assert.deepEqual(result.metadata.integrity.issues, [{ code: 'SHEET_METRICS_RECALCULATED', severity: 'warning', message: 'Recalculated', count: 1 }]);
});

test('comparison periods match elapsed Vietnam dates across month, week, custom and year boundaries', () => {
    const ranges = [
        [{}, '2026-10-08T03:00:00Z', '2026-09-01', '2026-09-08'],
        [{}, '2026-03-31T03:00:00Z', '2026-02-01', '2026-02-28'],
        [{}, '2024-03-31T03:00:00Z', '2024-02-01', '2024-02-29'],
        [{}, '2026-01-02T03:00:00Z', '2025-12-01', '2025-12-02'],
        [{ period: 'lastmonth' }, '2026-10-08T03:00:00Z', '2026-08-01', '2026-08-31'],
        [{ period: 'week' }, '2026-10-08T03:00:00Z', '2026-09-28', '2026-10-01'],
        [{ period: 'today' }, '2026-10-07T18:00:00Z', '2026-10-07', '2026-10-07'],
        [{ period: 'custom', from: '2026-10-03', to: '2026-10-05' }, '2026-10-08T03:00:00Z', '2026-09-30', '2026-10-02'],
        [{ period: 'custom', from: '2026-10-06', to: '2026-10-31' }, '2026-10-08T03:00:00Z', '2026-10-03', '2026-10-05']
    ];
    for (const [query, time, start, end] of ranges) {
        const value = comparisonPeriod(overviewPeriod(query, new Date(time)));
        assert.equal(value.start, start);
        assert.equal(value.end, end);
        assert.equal(value.timezone, 'Asia/Ho_Chi_Minh');
    }
    assert.equal(comparisonPeriod(overviewPeriod({ period: 'all' }, reference)), null);
    assert.equal(comparisonPeriod(overviewPeriod({ period: 'custom', from: '2026-11-01', to: '2026-11-05' }, reference)), null);
});

function comparisonSnapshot() {
    const input = snapshot();
    const rows = [];
    for (let day = 1; day <= 8; day++) {
        const current = daily(`${String(day).padStart(2, '0')}/10/2026`, 0, 90, 10);
        const previous = daily(`${String(day).padStart(2, '0')}/09/2026`, 0, 180, 20);
        current[6] = day === 1 ? 1 : 3;
        previous[6] = 2;
        current[12] = 1;
        previous[12] = 4;
        rows.push(current, previous);
    }
    rows.push(daily('09/09/2026', 0, 999999, 0), daily('THÁNG 9', 0, 999999, 0));
    input.sources.marketing.values = rows;
    return input;
}
const comparisonReference = new Date('2026-10-08T03:00:00Z');
const comparisonWindow = overviewPeriod({}, comparisonReference);

test('cost comparisons use ratios of period sums, exclude later baseline days and classify each metric separately', () => {
    const result = buildOverview(comparisonSnapshot(), comparisonWindow, comparisonReference);
    const c = result.marketing.comparison;
    assert.equal(result.marketing.costPerData, 800 / 22);
    assert.equal(c.costPerData.previous, 100);
    assert.equal(c.costPerData.change, (800 / 22 - 100) / 100);
    assert.equal(c.costPerData.direction, 'down');
    assert.equal(c.costPerArrived.previous, 50);
    assert.equal(c.costPerArrived.current, 100);
    assert.equal(c.costPerArrived.change, 1);
    assert.equal(c.costPerArrived.direction, 'up');
    assert.equal(c.period.end, '2026-09-08');
});

test('comparison refuses missing days, duplicate baseline days, stale sources and zero event counts', () => {
    for (const mutate of [
        input => input.sources.marketing.values.splice(1, 1),
        input => input.sources.marketing.values.splice(0, 1),
        input => input.sources.marketing.values.push(input.sources.marketing.values[1]),
        input => { input.sources.marketing.metadata.stale = true; },
        input => { input.sources.arrived.metadata.stale = true; },
        input => { delete input.sources.booked; },
        input => { input.sources.marketing.values[1][5] = null; }
    ]) {
        const input = comparisonSnapshot();
        mutate(input);
        const comparison = buildOverview(input, comparisonWindow, comparisonReference).marketing.comparison;
        assert.equal(comparison.costPerData.direction, null);
        assert.equal(comparison.costPerArrived.direction, null);
        assert.ok(comparison.costPerData.reason);
    }
    const input = comparisonSnapshot();
    for (const row of input.sources.marketing.values) if (/\/09\//.test(row[0])) row[12] = 0;
    let result = buildOverview(input, comparisonWindow, comparisonReference);
    assert.equal(result.marketing.comparison.costPerArrived.direction, null);
    assert.equal(result.marketing.comparison.costPerData.direction, 'down');
    input.sources.marketing.values.push(input.sources.marketing.values[1]);
    result = buildOverview(input, comparisonWindow, comparisonReference);
    assert.equal(result.marketing.costPerData, 800 / 22);
    assert.equal(result.marketing.comparison.costPerData.direction, null);
});

test('zero baseline cost and equal ratios never divide by zero or invent a percentage', () => {
    const input = comparisonSnapshot();
    for (const row of input.sources.marketing.values) if (/\/09\//.test(row[0])) row[5] = 0;
    let comparison = buildOverview(input, comparisonWindow, comparisonReference).marketing.comparison;
    assert.equal(comparison.costPerData.direction, 'up');
    assert.equal(comparison.costPerData.change, null);
    assert.equal(comparison.costPerData.previous, 0);
    for (const row of input.sources.marketing.values) row[5] = 0;
    comparison = buildOverview(input, comparisonWindow, comparisonReference).marketing.comparison;
    assert.equal(comparison.costPerData.direction, 'flat');
    assert.equal(comparison.costPerData.change, 0);
    const all = buildOverview(input, overviewPeriod({ period: 'all' }, comparisonReference), comparisonReference);
    assert.equal(all.marketing.comparison.costPerData.reason, 'no_period');
});
