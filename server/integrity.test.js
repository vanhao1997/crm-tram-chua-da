import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCrm, reconcileSources } from './integrity.js';

function crmRow({
    dataDate = '',
    appointmentDate = '',
    name = 'Khách A',
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

function marketingRow(date, {
    ads = 100,
    fee = 5,
    total = 105,
    leads = [0, 0, 0],
    booked = [0, 0, 0],
    arrived = [0, 0, 0],
    revenue = 0
} = {}) {
    const row = Array(16).fill(0);
    row[0] = date;
    row[3] = ads;
    row[4] = fee;
    row[5] = total;
    leads.forEach((value, index) => { row[6 + index] = value; });
    booked.forEach((value, index) => { row[9 + index] = value; });
    arrived.forEach((value, index) => { row[12 + index] = value; });
    row[15] = revenue;
    return row;
}

test('CRM inspection reports missing stable ids only when identity columns are available', () => {
    const snapshot = {
        sources: {
            leads: {
                values: [
                    ['header'],
                    crmRow({ dataDate: '31/02/2026', status: 'Đặt Hẹn' }),
                    crmRow({ dataDate: '01/10/2026', phone: '0907654321', status: 'Đặt Hẹn' }),
                    crmRow({ dataDate: '02/10/2026', phone: '0907654322' })
                ],
                identities: [null, null, { recordId: 'dup' }, { recordId: 'dup' }],
                metadata: { stale: false, identityAvailable: true }
            },
            booked: { values: [['header']], identities: [null], metadata: { stale: false, identityAvailable: true } },
            arrived: { values: [['header']], identities: [null], metadata: { stale: false, identityAvailable: true } }
        }
    };

    const result = inspectCrm(snapshot, '2026-10-06T00:00:00.000Z');
    const codes = result.issues.map(issue => issue.code);

    assert.equal(result.ok, false);
    assert.ok(codes.includes('CRM_INVALID_DATE'));
    assert.ok(codes.includes('RECORD_ID_MISSING'));
    assert.ok(codes.includes('RECORD_ID_DUPLICATE'));
    assert.ok(codes.includes('APPOINTMENT_MISSING'));
});

test('CRM inspection does not spam missing stable id issues before identity migration is enabled', () => {
    const snapshot = {
        sources: {
            leads: {
                values: [['header'], crmRow({ dataDate: '01/10/2026', status: 'Tư vấn' })],
                identities: [],
                metadata: { stale: false, identityAvailable: false }
            },
            booked: { values: [['header']], identities: [], metadata: { stale: false, identityAvailable: false } },
            arrived: { values: [['header']], identities: [], metadata: { stale: false, identityAvailable: false } }
        }
    };

    const result = inspectCrm(snapshot, '2026-10-06T00:00:00.000Z');

    assert.ok(!result.issues.some(issue => issue.code === 'RECORD_ID_MISSING'));
});

test('source reconciliation catches IFERROR-style false zeros and cost mismatches', () => {
    const crm = {
        snapshotId: 'crm-1',
        integrity: { issues: [] },
        sources: {
            leads: {
                values: [['header'], crmRow({ dataDate: '01/10/2026' })],
                metadata: { stale: false }
            },
            booked: { values: [['header']], metadata: { stale: false } },
            arrived: {
                values: [['header'], crmRow({ appointmentDate: '01/10/2026', revenueV: 500 })],
                metadata: { stale: false }
            }
        }
    };
    const marketing = {
        metadata: { snapshotId: 'mkt-1' },
        values: [marketingRow('01/10/2026', { total: 103, revenue: 500 })]
    };

    const result = reconcileSources(crm, marketing, '2026-10-06T00:00:00.000Z');
    const issues = result.issues.map(issue => [issue.code, issue.source]);

    assert.equal(result.ok, false);
    assert.ok(issues.some(([code, source]) => code === 'SOURCE_COUNT_DIFFERENCE' && source === 'leads'));
    assert.ok(issues.some(([code, source]) => code === 'SOURCE_COUNT_DIFFERENCE' && source === 'arrived'));
    assert.ok(result.issues.some(issue => issue.code === 'COST_MISMATCH'));
    assert.ok(!result.issues.some(issue => issue.code === 'SOURCE_REVENUE_DIFFERENCE'));
});

test('source reconciliation uses legacy V revenue when W revenue is blank', () => {
    const crm = {
        snapshotId: 'crm-1',
        integrity: { issues: [] },
        sources: {
            leads: { values: [['header']], metadata: { stale: false } },
            booked: { values: [['header']], metadata: { stale: false } },
            arrived: {
                values: [['header'], crmRow({ appointmentDate: '02/10/2026', revenueV: 700 })],
                metadata: { stale: false }
            }
        }
    };
    const marketing = {
        metadata: { snapshotId: 'mkt-1' },
        values: [marketingRow('02/10/2026', { arrived: [1, 0, 0], revenue: 700 })]
    };

    const result = reconcileSources(crm, marketing, '2026-10-06T00:00:00.000Z');

    assert.equal(result.ok, true);
    assert.ok(!result.issues.some(issue => issue.code === 'CRM_REVENUE_MISSING'));
    assert.ok(!result.issues.some(issue => issue.code === 'SOURCE_REVENUE_DIFFERENCE'));
});
