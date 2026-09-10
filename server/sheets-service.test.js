import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsService } from './sheets-service.js';

const sources = {
    leads: { name: 'leads', group: 'crm', spreadsheetId: 'crm', tab: 'LEADS', range: "'LEADS'!A:Z" },
    booked: { name: 'booked', group: 'crm', spreadsheetId: 'crm', tab: 'BOOKED', range: "'BOOKED'!A:Z" },
    arrived: { name: 'arrived', group: 'crm', spreadsheetId: 'crm', tab: 'ARRIVED', range: "'ARRIVED'!A:Z" },
    marketing: { name: 'marketing', group: 'marketing', spreadsheetId: 'mkt', tab: '2026', range: "'2026'!A:Z" }
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

test('permission failures are not retried and fail when no last-good data exists', async () => {
    let calls = 0;
    const client = {
        async batchGet() {
            calls += 1;
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
    assert.equal(calls, 1);
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
