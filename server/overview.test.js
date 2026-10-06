import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, overviewPeriod } from './overview.js';

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

test('overview preserves event dates and money, excludes future actuals and subtotal rows, and returns no customer detail', () => {
    const result = buildOverview(snapshot(), period);
    assert.deepEqual(result.crm, { leads: 1, appointments: 2, arrived: 1, revenue: 1234.5, derivedAppointments: 1 });
    assert.equal(result.marketing.received, 500);
    assert.equal(result.marketing.cost, 315.5);
    assert.equal(result.marketing.balance, 184.5);
    assert.equal(result.marketing.messages, 6);
    assert.equal(result.marketing.data, 4);
    assert.equal(result.marketing.roas, 1234.5 / 300.5);
    assert.equal(result.metadata.integrity.ok, true);
    assert.deepEqual(result.metadata.integrity.issues.map(issue => [issue.code, issue.count]), [['APPOINTMENTS_DERIVED', 1], ['SHEET_METRICS_RECALCULATED', 6]]);
    assert.doesNotMatch(JSON.stringify(result), /Private customer|0901234567|sourceRow|identities|values|Old missing revenue/);
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
    assert.equal(result.metadata.available.crm, false);
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
