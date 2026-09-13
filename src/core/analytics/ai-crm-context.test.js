import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrmContext } from './ai-crm-context.js';
import { buildAggregatePayload } from '../../features/dashboard/ai-marketing.js';

const model = { monthKey: '2026-09', selectedRange: { start: '2026-09-01', end: '2026-09-05' }, cutoffKey: '2026-09-07' };
test('CRM context respects custom end, Vietnam date boundary and source date semantics', () => {
    const result = buildCrmContext(model, { leads: [
        { date: new Date('2026-08-31T18:00:00Z'), aptDate: '2026-10-01', name: 'Private', phone: '0900000000' },
        { date: '2026-09-06' }, { date: null },
    ], arrived: [{ aptDate: '2026-09-03', revenue: null }] });
    assert.equal(result.sources.leads.count, 1);
    assert.deepEqual(result.sources.leads.byDate, { '2026-09-01': 1 });
    assert.equal(result.sources.leads.missingDateCount, 1);
    assert.equal(result.sources.booked.count, null);
    assert.equal(result.sources.arrived.revenue, null);
    assert.equal(JSON.stringify(result).includes('Private'), false);
    assert.equal(JSON.stringify(result).includes('0900000000'), false);
});
test('cutoff takes precedence over later selected end and recorded zero survives', () => {
    const result = buildCrmContext({ ...model, cutoffKey: '2026-09-02' }, { arrived: [
        { aptDate: '2026-09-02', revenue: 0 }, { aptDate: '2026-09-03', revenue: 100 },
    ] });
    assert.equal(result.sources.arrived.count, 1);
    assert.equal(result.sources.arrived.revenue, 0);
});
test('AI payload uses domain conversion field names and explicit null for missing numbers', () => {
    const payload = buildAggregatePayload({ ...model, currentPhase: 'early', phases: [{ phase: 'early', current: {
        efficiency: { leadToBooked: 0.5, bookedToArrived: 0.25 },
    } }] });
    assert.equal(payload.current.bookingRate, 0.5);
    assert.equal(payload.current.arrivalRate, 0.25);
    assert.equal(payload.current.ads, null);
});
