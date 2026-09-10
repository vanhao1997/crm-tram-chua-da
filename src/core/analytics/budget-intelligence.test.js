import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, cutoffDate, phaseOf, normalizeMarketingRecord, aggregatePhase, buildBudgetDecisionModel } from './budget-intelligence.js';
import { fetchAllData, fetchMarketingData } from '../api/sheets-api.js';

const day = (key, overrides = {}) => ({ date: new Date(`${key}T00:00:00+07:00`), marketing_cost: 100, ad_management_fee: 5, cost: 105, revenue: 400, messages: 30,
    data_nangco: 10, data_muichi: 0, data_khac: 0, hen_nangco: 5, hen_muichi: 0, hen_khac: 0, toi_nangco: 2, toi_muichi: 0, toi_khac: 0, ...overrides });
const referenceDate = new Date('2026-09-09T12:00:00+07:00');
const month = (m, overrides = {}, length = 7) => Array.from({ length }, (_, i) => day(`2026-${m}-${String(i + 1).padStart(2, '0')}`, overrides));
const historical = () => ['06', '07', '08'].flatMap(m => month(m));
const model = (records, options = {}) => buildBudgetDecisionModel(records, { referenceDate, ...options });

test('Vietnam calendar, month boundaries and D-2 cutoff do not depend on host timezone', () => {
    assert.equal(dateKey(cutoffDate(referenceDate)), '2026-09-07');
    assert.equal(dateKey(new Date('2026-09-08T18:00:00Z')), '2026-09-09');
    assert.equal(dateKey(cutoffDate(new Date('2026-03-01T00:00:00+07:00'))), '2026-02-27');
    for (const [d, p] of [[1,'early'],[10,'early'],[11,'mid'],[20,'mid'],[21,'late'],[30,'late']]) assert.equal(phaseOf(`2026-09-${String(d).padStart(2,'0')}`), p);
    assert.equal(dateKey('2026-02-30'), null);
});
test('normalization preserves missing values and detects invalid amounts', () => {
    const record = normalizeMarketingRecord(day('2026-09-01', { revenue: null, toi_nangco: null, cost: -1 }));
    assert.equal(record.arrivedTotal, null);
    assert.equal(record.revenue, null);
    assert.equal(record.dataCompleteness.complete, false);
    assert.equal(aggregatePhase([]).revenue, null);
    assert.equal(aggregatePhase([day('2026-09-01')]).efficiency.roas, 4);
    assert.equal(aggregatePhase([day('2026-09-01')]).efficiency.costPerArrived, 52.5);
});
test('increase capped at ten percent with matched historical days and no future leakage', () => {
    const m = model([...historical(), ...month('09', { revenue: 600 }), day('2026-09-08', { revenue: 999999 }), day('2026-10-01', { revenue: 999999 })], { adjustmentPercent: 50 });
    assert.equal(m.recommendation.action, 'increase');
    assert.equal(m.recommendation.percent, 10);
    assert.ok(Math.abs(m.recommendation.suggestedDailyAds - 110) < 1e-9);
    assert.equal(m.phases[0].current.revenue, 4200);
    assert.equal(m.phases[0].baseline.months, 3);
    assert.equal(m.phases[0].current.expectedDays, 7);
});
test('missing revenue, calendar gaps and duplicate dates block recommendations', () => {
    for (const current of [month('09',{revenue:null}),month('09').slice(1),[...month('09'),day('2026-09-01')]]) {
        assert.equal(model([...historical(),...current]).recommendation.action,'insufficient_data');
    }
    assert.equal(model([...month('06'),...month('07'),...month('08',{revenue:null}),...month('09')]).recommendation.action,'insufficient_data');
});
test('no Ads and stale data never yield actionable suggestions', () => {
    assert.equal(model([...historical(),...month('09',{marketing_cost:0,cost:0,ad_management_fee:0})]).recommendation.action,'insufficient_data');
    const m=model([...historical(),...month('09')],{stale:true});
    assert.equal(m.recommendation.suggestedDailyAds,null);
    assert.equal(m.phases[0].current.revenue,2800);
});
test('zero arrivals allows decrease without dividing by zero; mixed signals hold', () => {
    assert.equal(model([...historical(),...month('09',{toi_nangco:0,revenue:0})]).recommendation.action,'decrease');
    assert.equal(model([...historical(),...month('09',{revenue:300})]).recommendation.action,'hold');
    assert.equal(model([...historical(),...month('09',{hen_nangco:1})]).recommendation.action,'decrease');
});
test('historical view excludes later months and first days do not select previous month', () => {
    const m=model([...historical(),...month('09')],{monthKey:'2026-08'});
    assert.equal(m.phases[0].baseline.months,0); // Full August requires full historical phases, not seven days.
    const start=model([...historical()],{referenceDate:new Date('2026-09-01T12:00:00+07:00')});
    assert.equal(start.monthKey,'2026-09');
    assert.equal(start.recommendation.action,'insufficient_data');
    const selected=model([...historical(),...month('09')],{rangeStart:'2026-09-08',rangeEnd:'2026-09-09'});
    assert.equal(selected.phases[0].current.days,0);
});
test('1-2 closed days hold, source difference blocks increase but never rewrites data', () => {
    const short=model([...historical(),...month('09',{},2)],{referenceDate:new Date('2026-09-04T12:00:00+07:00')});
    assert.equal(short.recommendation.action,'hold');
    const m=model([...historical(),...month('09',{revenue:600})],{crmAvailable:true,crmRecords:[{aptDate:'2026-09-01',revenue:1}]});
    assert.equal(m.phases[0].current.revenue,4200);
    assert.equal(m.recommendation.action,'hold');
    assert.ok(m.recommendation.issues.some(i=>i.code==='SOURCE_DIFFERENCE'));
});
test('source parser retains V/W CRM revenue and Marketing totals without adding aggregate rows', async t => {
    const cellRow = (column, value) => { const r=Array(23).fill('');r[1]='01/09/2026';r[2]='Test';r[3]='0900000000';r[10]='03/09/2026';r[column]=value;return r; };
    const daily=['01/09/2026','',0,100,5,105,10,0,0,5,0,0,2,0,0,400,'',30];
    t.mock.method(globalThis,'fetch',async url => ({ok:true,json:async()=>({values:String(url).includes('marketing')?[['TỔNG',-100,1000],['THÁNG 9'],daily]:[cellRow(21,100),cellRow(22,200),cellRow(22,'')],metadata:{stale:false}})}));
    const crm=await fetchAllData('ignored'); assert.deepEqual(crm.arrived.map(r=>r.revenue),[100,200,null]);
    const marketing=await fetchMarketingData('ignored');assert.equal(marketing.length,1);assert.equal(marketing.globalBalance,-100);assert.equal(marketing.globalReceived,1000);assert.equal(marketing[0].dataTotal,10);assert.equal(marketing[0].monthKey,'2026-09');
});
