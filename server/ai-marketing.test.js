import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketing, normalizeAiResponse } from './ai-marketing.js';

const config = { aiEnabled: true, aiApiKey: 'test-only', aiBaseUrl: 'https://example.invalid/v1', aiModel: 'test', aiTimeoutMs: 20 };
const request = { periodKey: '2026-09', payload: { guardrails: { deterministicAction: 'hold', historicalSamples: 3, stale: false, criticalWarnings: 0 } } };
const valid = { summary: 'Review the available evidence.', action: 'hold', percent: 0, confidence: 'low',
  signals: [], nextSteps: [{ action: 'Verify data', owner: 'Manager', deadline: 'Before adjustment', reason: 'Missing revenue' }],
  reasons: [], checksBeforeChange: [], dataLimitations: [] };
const provider = data => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(data) } }] }) });

test('normalization cannot invent a valid response or silently cap unsafe percentages', () => {
  for (const data of [{}, { ...valid, action: 'unknown' }, { ...valid, percent: 25 },
    { ...valid, nextSteps: null }, { ...valid, reasons: [{}] }, { ...valid, action: 'increase', percent: -10 }]) {
    assert.equal(normalizeAiResponse(data), null);
  }
  assert.equal(normalizeAiResponse(valid).action, 'hold');
});
test('unsafe budget response is rejected in full, including its contradictory narrative', async () => {
  await assert.rejects(analyzeMarketing({ ...request, payload: { guardrails: { deterministicAction: 'insufficient_data' } } },
    config, provider({ ...valid, action: 'increase', percent: 10 })), { code: 'AI_INVALID_RESPONSE' });
});

test('missing or malformed guardrails never permit actionable analysis', async () => {
  const safeGuard = request.payload.guardrails;
  const guards = [undefined, null, [], {},
    ...Object.keys(safeGuard).map(key => Object.fromEntries(Object.entries(safeGuard).filter(([field]) => field !== key))),
    { ...safeGuard, historicalSamples: '3' }, { ...safeGuard, historicalSamples: 2 },
    { ...safeGuard, stale: true }, { ...safeGuard, criticalWarnings: -1 },
    { ...safeGuard, criticalWarnings: 1 }, { ...safeGuard, deterministicAction: 'unknown' }];
  for (const guardrails of guards) {
    for (const [action, percent] of [['increase', 10], ['decrease', -10], ['hold', 0]]) {
      await assert.rejects(analyzeMarketing({ ...request, payload: { guardrails } }, config,
        provider({ ...valid, action, percent })), { code: 'AI_INVALID_RESPONSE' });
    }
  }
});

test('verification-only prompt and result preserve missing-data explanation', async () => {
  const explanation = { ...valid, action: 'insufficient_data', percent: null, summary: 'Verify missing baseline.' };
  const result = await analyzeMarketing({ ...request, payload: {} }, config, async (_url, options) => {
    const sent = JSON.parse(options.body);
    assert.match(sent.messages[0].content, /requires action insufficient_data/);
    return provider(explanation)();
  });
  assert.equal(result.action, 'insufficient_data');
  assert.equal(result.summary, explanation.summary);
});
test('provider 4xx is not retried and does not leak response content', async () => {
  let calls = 0;
  await assert.rejects(analyzeMarketing(request, config, async () => { calls++; return { ok: false, status: 401 }; }), { code: 'AI_PROVIDER_ERROR' });
  assert.equal(calls, 1);
});
test('empty requests are rejected before contacting provider', async () => {
  let calls = 0;
  await assert.rejects(analyzeMarketing({}, config, async () => { calls++; }), { code: 'AI_INVALID_INPUT' });
  await assert.rejects(analyzeMarketing(undefined, config, async () => { calls++; }), { code: 'AI_INVALID_INPUT' });
  assert.equal(calls, 0);
});
test('network timeout retries at most once', async () => {
  let calls = 0;
  await assert.rejects(analyzeMarketing(request, config, async () => { calls++; throw new Error('private provider details'); }), { code: 'AI_TIMEOUT' });
  assert.equal(calls, 2);
});
test('slow provider body is bounded by the total timeout', async () => {
  let signal;
  await assert.rejects(analyzeMarketing(request, config, async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: async () => new Promise(() => {}) };
  }), { code: 'AI_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('completed responses clear their deadline timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  await analyzeMarketing(request, config, async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }) };
  });
  t.mock.timers.tick(2000);
  assert.equal(signal.aborted, false);
});
test('valid response keeps concrete next steps', async () => {
  const result = await analyzeMarketing(request, config, provider(valid));
  assert.deepEqual(result.nextSteps, valid.nextSteps);
  assert.equal(result.sourcePeriod, request.periodKey);
  assert.notEqual(result.generatedAt, valid.generatedAt);
});
test('accepts provider structured content parts', async () => {
  const result = await analyzeMarketing(request, config, async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(valid) }] } }] })
  }));
  assert.equal(result.action, 'hold');
  assert.deepEqual(result.nextSteps, valid.nextSteps);
});
