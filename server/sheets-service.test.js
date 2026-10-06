import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsService } from './sheets-service.js';

const sources = {
    leads: { name: 'leads', group: 'crm', spreadsheetId: 'crm', tab: 'LEADS', sheetId: 101, range: "'LEADS'!A:Z" },
    booked: { name: 'booked', group: 'crm', spreadsheetId: 'crm', tab: 'BOOKED', sheetId: 102, range: "'BOOKED'!A:Z" },
    arrived: { name: 'arrived', group: 'crm', spreadsheetId: 'crm', tab: 'ARRIVED', sheetId: 103, range: "'ARRIVED'!A:Z" },
    marketing: { name: 'marketing', group: 'marketing', spreadsheetId: 'mkt', tab: '2026', sheetId: 201, range: "'2026'!A:Z" }
};

function createClock() {
    let value = 1_700_000_000_000;
    return {
        now: () => value,
        advance(ms) {
            value += ms;
        }
    };
}

const fixedNowOct6 = () => Date.parse('2026-10-06T03:00:00.000Z');

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
    ads = 0,
    fee = 0,
    total = 0,
    leads = [0, 0, 0],
    booked = [0, 0, 0],
    arrived = [0, 0, 0],
    revenue = 0
} = {}) {
    const row = Array(26).fill(0);
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

function serviceWithSnapshots({ leads = [['header']], booked = [['header']], arrived = [['header']], marketing = [] }) {
    const client = {
        async batchGet(request) {
            if (request.spreadsheetId === 'crm') {
                return [{ values: leads }, { values: booked }, { values: arrived }];
            }
            if (request.spreadsheetId === 'mkt') return [{ values: marketing }];
            throw new Error(`Unexpected spreadsheet ${request.spreadsheetId}`);
        }
    };
    return createSheetsService({
        sources,
        client,
        now: fixedNowOct6,
        retryCount: 0,
        logger: { warn() {}, info() {} }
    });
}

test('CRM sources share one atomic batch snapshot and cache', async () => {
    const clock = createClock();
    let calls = 0;
    const client = {
        async batchGet(request) {
            calls += 1;
            assert.equal(request.spreadsheetId, 'crm');
            assert.equal(request.ranges.length, 3);
            assert.equal(request.valueRenderOption, 'UNFORMATTED_VALUE');
            assert.equal(request.dateTimeRenderOption, 'FORMATTED_STRING');
            return request.ranges.map((range, index) => ({ range, values: [[String(index + 1)]] }));
        }
    };
    const service = createSheetsService({ sources, client, now: clock.now, cacheMs: 60_000 });

    const [leads, booked, arrived] = await Promise.all([
        service.getSource('leads'),
        service.getSource('booked'),
        service.getSource('arrived')
    ]);

    assert.equal(calls, 1);
    assert.equal(leads.metadata.snapshotId, booked.metadata.snapshotId);
    assert.equal(booked.metadata.snapshotId, arrived.metadata.snapshotId);
    assert.equal(leads.metadata.stale, false);
    assert.deepEqual(leads.values, [['1']]);

    await service.getSource('leads');
    assert.equal(calls, 1);
});

test('CRM refresh failure returns the previous complete snapshot as stale', async () => {
    const clock = createClock();
    let calls = 0;
    const client = {
        async batchGet() {
            calls += 1;
            if (calls > 1) {
                const error = new Error('temporary upstream failure');
                error.code = 503;
                throw error;
            }
            return [
                { values: [['leads-v1']] },
                { values: [['booked-v1']] },
                { values: [['arrived-v1']] }
            ];
        }
    };
    const service = createSheetsService({
        sources,
        client,
        now: clock.now,
        cacheMs: 1,
        retryCount: 0,
        sleepFn: async () => {}
    });

    const first = await service.getSource('leads');
    clock.advance(10);
    const stale = await service.getSource('arrived');

    assert.equal(calls, 2);
    assert.equal(first.metadata.stale, false);
    assert.equal(stale.metadata.stale, true);
    assert.deepEqual(stale.values, [['arrived-v1']]);
    assert.ok(stale.metadata.warnings.includes('stale_data'));
});

test('marketing financial values remain readable but CRM-dependent metrics become unavailable when CRM fails', async () => {
    const client = {
        async batchGet(request) {
            if (request.spreadsheetId === 'crm') {
                const error = new Error('Source unavailable');
                error.code = 403;
                throw error;
            }
            const day = Array(26).fill(0);
            day[0] = '01/10/2026'; day[2] = 1000; day[3] = 100; day[4] = 5; day[5] = 105;
            return [{ values: [day] }];
        }
    };
    const service = createSheetsService({ sources, client, now: fixedNowOct6, retryCount: 0 });
    const result = await service.getSource('marketing');
    assert.equal(result.values[0][2], 1000);
    assert.equal(result.values[0][5], 105);
    assert.ok(result.values[0].slice(6, 17).every(value => value === null));
    assert.equal(result.metadata.calculationSource, 'crm_unavailable');
    assert.ok(result.metadata.integrity.issues.some(issue => issue.code === 'CRM_UNAVAILABLE' && issue.severity === 'critical'));
});

test('permission failures are not retried and fail when no last-good data exists', async () => {
    let calls = 0;
    const contexts = [];
    const client = {
        async batchGet(request) {
            calls += 1;
            contexts.push(request.spreadsheetId);
            const error = new Error('forbidden');
            error.code = 403;
            throw error;
        }
    };
    const service = createSheetsService({
        sources,
        client,
        retryCount: 2,
        sleepFn: async () => {}
    });

    await assert.rejects(
        service.getSource('marketing'),
        error => error.code === 'SHEETS_PERMISSION_DENIED' && error.status === 502
    );
    assert.equal(calls, 2);
    assert.deepEqual(contexts.sort(), ['crm', 'mkt']);
});

test('partial CRM batch response does not replace last-good snapshot', async () => {
    const clock = createClock();
    let calls = 0;
    const client = {
        async batchGet() {
            calls += 1;
            if (calls === 1) {
                return [{ values: [['a']] }, { values: [['b']] }, { values: [['c']] }];
            }
            return [{ values: [['new-a']] }];
        }
    };
    const service = createSheetsService({
        sources,
        client,
        now: clock.now,
        cacheMs: 1,
        retryCount: 0,
        sleepFn: async () => {}
    });

    await service.getSource('leads');
    clock.advance(10);
    const stale = await service.getSource('booked');
    assert.equal(stale.metadata.stale, true);
    assert.deepEqual(stale.values, [['b']]);
});

test('resolved CRM source identities and stable row identities are preserved on source results', async () => {
    const resolved = [
        { ...sources.leads, tab: 'DATA NGUỒN MKT', range: "'DATA NGUỒN MKT'!A:Z" },
        { ...sources.booked, tab: 'KHÁCH ĐẶT HẸN', range: "'KHÁCH ĐẶT HẸN'!A:Z" },
        { ...sources.arrived, tab: 'KHÁCH ĐÃ ĐẾN', range: "'KHÁCH ĐÃ ĐẾN'!A:Z" }
    ];
    const client = {
        async resolveSources(definitions) {
            assert.deepEqual(definitions.map(definition => definition.sheetId), [101, 102, 103]);
            return resolved;
        },
        async batchGet(request) {
            assert.deepEqual(request.ranges, resolved.map(definition => definition.range));
            assert.deepEqual(request.identityRanges, ["'DATA NGUỒN MKT'!FS:FX", "'KHÁCH ĐẶT HẸN'!FS:FX", "'KHÁCH ĐÃ ĐẾN'!FS:FX"]);
            return [
                {
                    values: [['header'], ['', '01/10/2026', 'Lan', '0901234567']],
                    identityValues: [
                        ['bsn_record_id', 'lead_id', 'appointment_id', 'visit_id', 'bsn_updated_at', 'bsn_business_hash'],
                        ['rec-1', 'lead-1', '', '', '2026-10-06T01:00:00.000Z', 'hash-1']
                    ]
                },
                { values: [['header']], identityValues: [['bsn_record_id', 'lead_id', 'appointment_id', 'visit_id', 'bsn_updated_at', 'bsn_business_hash']] },
                { values: [['header']], identityValues: [['bsn_record_id', 'lead_id', 'appointment_id', 'visit_id', 'bsn_updated_at', 'bsn_business_hash']] }
            ];
        }
    };
    const service = createSheetsService({ sources, client, retryCount: 0, identityColumns: 'FS:FX' });

    const result = await service.getSource('leads');

    assert.equal(result.metadata.sheetTab, 'DATA NGUỒN MKT');
    assert.equal(result.metadata.sheetId, 101);
    assert.equal(result.metadata.spreadsheetId, 'crm');
    assert.match(result.metadata.workspaceId, /^[a-f0-9]{16}$/);
    assert.equal(result.identities[1].recordId, 'rec-1');
    assert.equal(result.identities[1].leadId, 'lead-1');
    assert.equal(result.identities[1].sourceRow, 2);
});

test('CRM identity checks stay disabled when resolved sources report identity layer unavailable', async () => {
    const resolved = [
        { ...sources.leads, identityAvailable: false },
        { ...sources.booked, identityAvailable: false },
        { ...sources.arrived, identityAvailable: false }
    ];
    const client = {
        async resolveSources() {
            return resolved;
        },
        async batchGet(request) {
            assert.ok(!request.identityRanges?.some(Boolean));
            return [
                { values: [['header'], ['', '01/10/2026', 'Lan', '0901234567']] },
                { values: [['header']] },
                { values: [['header']] }
            ];
        }
    };
    const service = createSheetsService({ sources, client, retryCount: 0 });

    const result = await service.getSource('leads');

    assert.equal(result.metadata.identityAvailable, false);
    assert.ok(!result.metadata.integrity.issues.some(issue => issue.code === 'RECORD_ID_MISSING'));
});

test('last-good CRM snapshots expire after the max stale window instead of serving old data', async () => {
    const clock = createClock();
    let calls = 0;
    const client = {
        async batchGet() {
            calls += 1;
            if (calls === 1) return [
                { values: [['leads-v1']] },
                { values: [['booked-v1']] },
                { values: [['arrived-v1']] }
            ];
            const error = new Error('temporary upstream failure');
            error.code = 503;
            throw error;
        }
    };
    const service = createSheetsService({
        sources,
        client,
        now: clock.now,
        cacheMs: 1,
        maxStaleMs: 15 * 60_000,
        retryCount: 0,
        sleepFn: async () => {}
    });

    await service.getSource('leads');
    clock.advance(15 * 60_000 + 1);

    await assert.rejects(
        service.getSource('booked'),
        error => error.code === 'SHEETS_SNAPSHOT_EXPIRED' && error.status === 503
    );

    const status = service.getStatus();
    assert.equal(status.sources.leads.expired, true);
    assert.equal(status.sources.booked.available, false);
});

test('getIntegrity blocks current-month budget decisions when Ads has spend but visits are not recorded', async () => {
    const service = serviceWithSnapshots({
        arrived: [
            ['header'],
            crmRow({ dataDate: '26/09/2026', appointmentDate: '26/09/2026', revenueV: 900 })
        ],
        marketing: [
            marketingRow('26/09/2026', { arrived: [1, 0, 0], revenue: 900 }),
            marketingRow('01/10/2026', { ads: 100, fee: 5, total: 105 })
        ]
    });

    const integrity = await service.getIntegrity();
    const issue = integrity.issues.find(item => item.code === 'VISITS_NOT_RECORDED_THIS_MONTH');

    assert.equal(integrity.ok, false);
    assert.equal(issue.severity, 'critical');
    assert.equal(issue.monthKey, '2026-10');
    assert.equal(issue.latestEventDate, '2026-09-26');
});

test('canonical marketing metrics correct false-zero sheet counts from CRM while raw input stays read-only', async () => {
    const rawMarketing = [marketingRow('01/10/2026', { leads: [0, 0, 0] })];
    const service = serviceWithSnapshots({
        leads: [['header'], crmRow({ dataDate: '01/10/2026' })],
        marketing: rawMarketing
    });

    const marketing = await service.getSource('marketing');
    const corrected = marketing.metadata.integrity.issues.find(issue => issue.code === 'SHEET_METRICS_RECALCULATED');

    assert.equal(marketing.values[0][6], 1);
    assert.equal(rawMarketing[0][6], 0);
    assert.equal(corrected.severity, 'warning');
    assert.equal(corrected.corrected, true);
    assert.equal(corrected.monthKey, '2026-10');
    assert.equal(corrected.count, 1);
    assert.equal(marketing.metadata.calculationSource, 'fresh_crm_events');
});

test('missing raw visit revenue creates one CRM revenue issue without duplicative source revenue mismatch', async () => {
    const service = serviceWithSnapshots({
        arrived: [['header'], crmRow({ dataDate: '02/10/2026', appointmentDate: '02/10/2026' })],
        marketing: [marketingRow('02/10/2026', { arrived: [1, 0, 0], revenue: 0 })]
    });

    const marketing = await service.getSource('marketing');
    const issues = marketing.metadata.integrity.issues;

    assert.equal(issues.filter(issue => issue.code === 'CRM_REVENUE_MISSING').length, 1);
    assert.equal(issues.filter(issue => issue.code === 'SOURCE_REVENUE_DIFFERENCE').length, 0);
    assert.equal(marketing.values[0][15], null);
});
