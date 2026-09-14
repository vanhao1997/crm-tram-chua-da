import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrmContext } from './ai-crm-context.js';
import { buildAggregatePayload } from '../../features/dashboard/ai-marketing.js';
import { buildBudgetDecisionModel } from './budget-intelligence.js';
import { validateAiInput } from '../../../server/ai-marketing.js';

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

test('AI history carries matched custom windows and fees from the daily source', () => {
    const records = ['06', '07', '08', '09', '10'].flatMap(month => Array.from({ length: 7 }, (_, i) => ({
        date: `2026-${month}-${String(i + 1).padStart(2, '0')}`, marketing_cost: 100, ad_management_fee: 5,
        cost: 105, revenue: 400, data_nangco: 10, data_muichi: 0, data_khac: 0,
        hen_nangco: 5, hen_muichi: 0, hen_khac: 0, toi_nangco: 2, toi_muichi: 0, toi_khac: 0,
    })));
    const budget = buildBudgetDecisionModel(records, {
        referenceDate: new Date('2026-09-09T12:00:00+07:00'),
        monthKey: '2026-09', rangeStart: '2026-09-03', rangeEnd: '2026-09-05',
    });
    const payload = buildAggregatePayload(budget);
    assert.deepEqual(payload.historicalWindows.map(({ startDate, endDate }) => [startDate, endDate]), [
        ['2026-06-03', '2026-06-05'], ['2026-07-03', '2026-07-05'], ['2026-08-03', '2026-08-05'],
    ]);
    assert.equal(payload.historical.phaseBaselines[0].sampleMonths, 3);
    assert.equal(payload.historical.sampleMonths, 3);
    assert.equal(payload.current.managementFee, 15);
    assert.equal(payload.current.totalCost, payload.current.ads + payload.current.managementFee);
    assert.equal(payload.period.phaseStartDate, '2026-09-03');
    assert.equal(payload.period.phaseEndDate, '2026-09-05');
    assert.deepEqual(payload.daily.map(row => row.date), ['2026-09-03', '2026-09-04', '2026-09-05']);
    assert.doesNotThrow(() => validateAiInput({ periodKey: budget.monthKey, payload }));
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
    assert.equal(payload.current.managementFee, null);
    assert.equal(payload.period.startDate, '2026-09-01');
    assert.equal(payload.period.endDate, '2026-09-05');
    assert.equal(payload.period.phaseStartDate, null);
});
