import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withServer(app, callback) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    try {
        return await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('Telegram group overrides are validated, defaulted and never expose bot token', async () => {
    const sent = [];
    const app = createApp({
        service: { getStatus: () => ({ configured: true }) },
        config: { production: false, telegramBotToken: 'test-private-token', telegramChatId: '-123456' },
        sendTelegram: async (token, method, body) => { sent.push(body); return { ok: true, payload: { ok: true } }; }
    });
    await withServer(app, async base => {
        const config = await (await fetch(`${base}/api/telegram/settings`)).json();
        assert.deepEqual(config, { botConfigured: true, defaultChatId: '-123456' });
        const send = body => fetch(`${base}/api/telegram/send-record`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'SĐT: 0901234567', ...body })
        });
        for (const chatId of ['123', '@group', 'https://web.telegram.org/k/#-123', {}, '-9007199254740992']) {
            assert.equal((await send({ chatId })).status, 400);
        }
        assert.equal(sent.length, 0);
        assert.equal((await send({ chatId: ' -1001234567890 ' })).status, 200);
        assert.equal(sent[0].chat_id, '-1001234567890');
        assert.equal(sent[0].entities[0].type, 'phone_number');
        assert.equal((await send({ chatId: '' })).status, 200);
        assert.equal(sent[1].chat_id, '-123456');
    });
});

function makeApp() {
    const sources = {
        leads: { name: 'leads', group: 'crm', spreadsheetId: 'crm-sheet', tab: 'DATA NGUỒN MKT', range: "'DATA NGUỒN MKT'!A:Z" },
        booked: { name: 'booked', group: 'crm', spreadsheetId: 'crm-sheet', tab: 'KHÁCH ĐẶT HẸN', range: "'KHÁCH ĐẶT HẸN'!A:Z" },
        arrived: { name: 'arrived', group: 'crm', spreadsheetId: 'crm-sheet', tab: 'KHÁCH ĐÃ ĐẾN', range: "'KHÁCH ĐÃ ĐẾN'!A:Z" },
        marketing: { name: 'marketing', group: 'marketing', spreadsheetId: 'marketing-sheet', tab: '2026', range: "'2026'!A:Z" }
    };
    const service = {
        async getSource(source) {
            return {
                values: [[source, 1]],
                metadata: {
                    source,
                    group: sources[source].group,
                    sheetTab: sources[source].tab,
                    spreadsheetId: sources[source].spreadsheetId,
                    snapshotId: 'test-snapshot',
                    stale: false,
                    warnings: []
                }
            };
        },
        getStatus() {
            return { configured: true };
        }
    };
    return createApp({
        service,
        config: {
            production: false,
            serveStatic: false,
            trustedProxyCidrs: [],
            allowedClientCidrs: [],
            sources
        },
        logger: { error() {}, warn() {} }
    });
}

test('sheets endpoint accepts only allowlisted source', async () => {
    await withServer(makeApp(), async baseUrl => {
        const ok = await fetch(`${baseUrl}/api/sheets?source=leads`);
        assert.equal(ok.status, 200);
        const payload = await ok.json();
        assert.deepEqual(payload.values, [['leads', 1]]);
        assert.deepEqual(payload.metadata.sourceIdentity, {
            source: 'leads',
            group: 'crm',
            spreadsheetId: 'crm-sheet',
            sheetTab: 'DATA NGUỒN MKT',
            sheetId: null,
            range: "'DATA NGUỒN MKT'!A:Z"
        });

        const generic = await fetch(`${baseUrl}/api/sheets?id=crm&range=LEADS!A:Z`);
        assert.equal(generic.status, 400);

        const unknown = await fetch(`${baseUrl}/api/sheets?source=unknown`);
        assert.equal(unknown.status, 400);
    });
});

test('overview endpoint returns only aggregates, validates period selectors, and reports total outage', async () => {
    let calls = 0;
    let snapshot = { sources: Object.fromEntries(['leads', 'booked', 'arrived', 'marketing'].map(name => [name, {
        values: [['header', 'private source detail']], metadata: { stale: false, fetchedAt: '2026-10-06T03:00:00Z' }
    }])), integrity: { issues: [] } };
    const app = createApp({
        service: { getOverviewSnapshot: async () => { calls++; return snapshot; } },
        config: { production: false, serveStatic: false, appVersion: 'test-release' },
        logger: { error() {} }
    });
    await withServer(app, async base => {
        for (const query of ['period=unknown', 'period=month&period=all', 'id=other', 'range=A:Z', 'period=custom&from=2026-02-30&to=2026-03-01']) {
            assert.equal((await fetch(`${base}/api/overview?${query}`)).status, 400);
        }
        assert.equal(calls, 0);
        const response = await fetch(`${base}/api/overview?period=custom&from=2026-10-01&to=2026-10-06`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        const payload = await response.json();
        assert.equal(payload.period.key, 'custom');
        assert.equal(payload.metadata.version, 'test-release');
        assert.ok(payload.schedule);
        assert.equal(payload.schedule.available, true);
        assert.doesNotMatch(JSON.stringify(payload), /private source detail|values|identities/);
        snapshot = { sources: {}, integrity: { issues: [] } };
        const unavailable = await fetch(`${base}/api/overview`);
        assert.equal(unavailable.status, 503);
        assert.equal((await unavailable.json()).crm.leads, null);
    });
});

test('hashed static assets cache safely while HTML is revalidated for new deployments', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsn-overview-'));
    try {
        fs.mkdirSync(path.join(root, 'assets'));
        fs.writeFileSync(path.join(root, 'index.html'), '<main>Overview</main>');
        fs.writeFileSync(path.join(root, 'assets', 'main-1234abcd.js'), 'export {};');
        const app = createApp({ service: {}, config: { production: false, serveStatic: true, staticDir: root } });
        await withServer(app, async base => {
            const html = await fetch(base);
            const asset = await fetch(`${base}/assets/main-1234abcd.js`);
            assert.equal(html.headers.get('Cache-Control'), 'no-cache');
            assert.equal(asset.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('integrity endpoint returns service report without accepting external source selectors', async () => {
    const calls = [];
    const app = createApp({
        service: {
            getStatus: () => ({ configured: true }),
            getIntegrity: async () => {
                calls.push('integrity');
                return { ok: true, reportId: 'integrity-2026-10', mismatches: [] };
            }
        },
        config: {
            production: false,
            serveStatic: false,
            trustedProxyCidrs: [],
            allowedClientCidrs: []
        },
        logger: { error() {}, warn() {} }
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/integrity?id=other-workbook&range=A:Z`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, reportId: 'integrity-2026-10', mismatches: [] });
        assert.deepEqual(calls, ['integrity']);
    });
});

test('integrity endpoint reports unavailable service contract explicitly', async () => {
    await withServer(makeApp(), async baseUrl => {
        const response = await fetch(`${baseUrl}/api/integrity`);
        assert.equal(response.status, 501);
        assert.equal((await response.json()).code, 'INTEGRITY_NOT_IMPLEMENTED');
    });
});

test('AI provider endpoint is removed from the public API', async () => {
    await withServer(makeApp(), async baseUrl => {
        const response = await fetch(`${baseUrl}/api/marketing/ai-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ periodKey: '2026-10', payload: {} })
        });
        assert.equal(response.status, 404);
    });
});

test('health endpoints distinguish live and ready responses', async () => {
    await withServer(makeApp(), async baseUrl => {
        const live = await fetch(`${baseUrl}/api/health/live`);
        const ready = await fetch(`${baseUrl}/api/health/ready`);
        assert.equal(live.status, 200);
        assert.equal((await live.json()).status, 'live');
        assert.equal(ready.status, 200);
        assert.equal((await ready.json()).status, 'ready');
    });
});

test('readiness exposes per-source freshness and fails only explicit unavailable or expired status', async () => {
    const app = createApp({
        service: {
            getStatus: () => ({
                configured: true,
                sources: {
                    leads: { group: 'crm', stale: true, expired: false, available: true, fetchedAt: '2026-10-06T03:00:00.000Z', snapshotId: 'crm-1', warnings: ['stale_data'] },
                    marketing: { group: 'marketing', stale: true, expired: true, available: false, fetchedAt: '2026-10-05T03:00:00.000Z', snapshotId: 'marketing-1', warnings: ['expired_data'] }
                }
            })
        },
        config: {
            production: false,
            serveStatic: false,
            trustedProxyCidrs: [],
            allowedClientCidrs: []
        },
        logger: { error() {}, warn() {} }
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health/ready`);
        const payload = await response.json();
        assert.equal(response.status, 503);
        assert.equal(payload.status, 'not_ready');
        assert.equal(payload.sources.leads.stale, true);
        assert.equal(payload.sources.leads.expired, false);
        assert.equal(payload.sources.marketing.expired, true);
        assert.equal(payload.sources.marketing.available, false);
    });
});

test('production network middleware blocks clients outside allowlist', async () => {
    const app = createApp({
        service: {
            getStatus: () => ({ configured: true }),
            getSource: async () => ({ values: [], metadata: {} })
        },
        config: {
            production: true,
            serveStatic: false,
            trustedProxyCidrs: [],
            allowedClientCidrs: ['10.0.0.0/8']
        },
        logger: { error() {}, warn() {} }
    });
    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health/live`);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, 'NETWORK_DENIED');
    });
});
