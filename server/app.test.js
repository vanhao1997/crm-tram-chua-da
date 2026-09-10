import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';

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
    const service = {
        async getSource(source) {
            return {
                values: [[source, 1]],
                metadata: {
                    source,
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
            allowedClientCidrs: []
        },
        logger: { error() {}, warn() {} }
    });
}

test('sheets endpoint accepts only allowlisted source', async () => {
    await withServer(makeApp(), async baseUrl => {
        const ok = await fetch(`${baseUrl}/api/sheets?source=leads`);
        assert.equal(ok.status, 200);
        assert.deepEqual((await ok.json()).values, [['leads', 1]]);

        const generic = await fetch(`${baseUrl}/api/sheets?id=crm&range=LEADS!A:Z`);
        assert.equal(generic.status, 400);

        const unknown = await fetch(`${baseUrl}/api/sheets?source=unknown`);
        assert.equal(unknown.status, 400);
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
