import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dateKey } from './budget-intelligence.js';
import { deriveCustomers, getDateRange, hasConfirmedTime, inDateFilter, isUpcomingAppointment, normalizePhone, sortAppointments } from '../../features/dashboard/ui-helpers.js';
import { chart } from '../../features/dashboard/budget-view.js';
import { fetchAllData, formatDateFull, formatDateShort } from '../api/sheets-api.js';
import { renderRevenueChart, renderRevenuePieChart } from '../../features/dashboard/charts.js';

test('revenue charts hide incomplete totals and preserve numeric decimals', t => {
  const globals = ['document', 'window', 'Chart', 'requestAnimationFrame'];
  const descriptors = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const key of globals) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else delete globalThis[key];
    }
  });
  let empty;
  let chartData;
  const parent = {
    querySelector: () => empty,
    appendChild: element => { empty = element; }
  };
  const canvas = { style: {}, parentElement: parent };
  const bars = { innerHTML: '' };
  globalThis.document = {
    getElementById: id => id === 'revenuePieChart' ? canvas : bars,
    createElement: () => ({ style: {}, remove() { empty = undefined; } })
  };
  globalThis.window = {};
  globalThis.requestAnimationFrame = () => {};
  globalThis.Chart = class {
    constructor(_canvas, options) { chartData = options.data; }
    destroy() {}
  };

  const incomplete = [{ service: 'A', revenue: 100 }, { service: 'B', revenue: null }];
  renderRevenueChart(incomplete);
  renderRevenuePieChart(incomplete);
  assert.match(bars.innerHTML, /Chưa nhập đủ doanh thu/);
  assert.match(empty.textContent, /Chưa nhập đủ doanh thu/);
  assert.equal(chartData, undefined);
  assert.equal(canvas.style.display, 'none');

  renderRevenuePieChart([{ service: 'A', revenue: 1234.5 }]);
  assert.deepEqual(chartData.datasets[0].data, [1234.5]);
  assert.equal(canvas.style.display, '');
  assert.equal(empty, undefined);
});
test('frontend entrypoint parses (unit suites alone do not bundle it)', () => {
  execFileSync(process.execPath, ['--check', 'src/main.js']);
});
test('invalid calendar input cannot roll into another month', async t => {
  const row = date => { const r = Array(23).fill(''); r[1] = date; r[2] = 'Test'; r[10] = date; return r; };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ values: [row('31/02/2026'), row('29/02/2024'), row('Date(2026,1,31)'), row('00/09/2026')] }) }));
  const data = await fetchAllData('ignored');
  assert.ok(data.leads.every(r => !r.date || dateKey(r.date) === '2024-02-29'));
  assert.ok(data.leads.some(r => dateKey(r.date) === '2024-02-29'));
});
test('upcoming includes later today, excludes elapsed time, retains unknown time', () => {
  const now = new Date('2026-09-10T14:00:00+07:00');
  const apt = time => ({ aptDate: new Date('2026-09-10T00:00:00+07:00'), time });
  assert.equal(hasConfirmedTime(apt('99:99')), false);
  assert.equal(hasConfirmedTime(apt('24:00')), false);
  assert.equal(hasConfirmedTime(apt(' 15h30 ')), true);
  assert.equal(isUpcomingAppointment(apt('15:00'), now), true);
  assert.equal(isUpcomingAppointment(apt('13:00'), now), false);
  assert.equal(isUpcomingAppointment(apt(''), now), true);
  assert.equal(sortAppointments([apt(''), apt('15:00')], now)[0].time, '15:00');
});
test('customer unknown revenue remains null while recorded zero remains zero', () => {
  const row = revenue => ({ phone: '0900000000', name: 'Test', revenue, aptDate: new Date(2026, 8, 1) });
  assert.equal(deriveCustomers({ arrived: [row(null)] })[0].revenue, null);
  assert.equal(deriveCustomers({ arrived: [row(0), row(null)] })[0].revenue, 0);
  const customer = deriveCustomers({ arrived: [{...row(10), service:'A'}, {...row(20), service:'B'}] })[0];
  assert.equal(customer.revenue, 30);
  assert.ok(customer.services.has('B'));
});
test('chart distinguishes zero, missing and positive data without a minimum fake bar', () => {
  const html = chart('Test', [{label:'a',value:null},{label:'b',value:0},{label:'c',value:100}], 'green');
  assert.match(html, /Thiếu dữ liệu/);
  assert.equal((html.match(/height:0%/g) || []).length, 2);
  assert.match(html, /height:100%/);
});
test('malformed API snapshots fail instead of replacing last-good data with empty rows', async t => {
  for (const payload of [{}, {values:null}, {values:[{}]}]) {
    t.mock.method(globalThis, 'fetch', async () => ({ok:true,json:async()=>payload}));
    await assert.rejects(fetchAllData('ignored'), /API/);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,json:async()=>({values:[]})}));
  assert.deepEqual((await fetchAllData('ignored')).leads, []);
});
test('status is inferred from notes when Sheet status is blank', async t => {
  const row = Array(23).fill(''); row[1]='01/09/2026'; row[2]='Test'; row[3]='0900000000'; row[12]='Không nghe máy';
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,json:async()=>({values:[row]})}));
  const result = await fetchAllData('ignored');
  assert.equal(result.leads[0].status, 'Không Nghe Máy');
});
test('dashboard dates use Vietnam business days independent of viewer timezone', () => {
  const reference = new Date('2026-10-05T18:30:00Z');
  const range = getDateRange('today', '', '', reference);
  assert.equal(dateKey(range.start), '2026-10-06');
  assert.equal(dateKey(range.end), '2026-10-06');
  assert.equal(inDateFilter(new Date('2026-10-05T18:45:00Z'), 'today', '', '', reference), true);
  assert.equal(inDateFilter(new Date('2026-10-05T16:45:00Z'), 'today', '', '', reference), false);
  assert.equal(formatDateFull(new Date('2026-10-05T18:45:00Z')), '06/10/2026');
  assert.equal(formatDateShort(new Date('2026-10-05T18:45:00Z')), '06/10');
});
test('phone normalization preserves local numbers that begin with 84 but are not country-code form', () => {
  assert.equal(normalizePhone('84912345678'), '0912345678');
  assert.equal(normalizePhone('841234567'), '0841234567');
});
test('row identity metadata does not overwrite acquisition source', async t => {
  const row = Array(23).fill('');
  row[1] = '01/10/2026'; row[2] = 'Test'; row[3] = '0900000000'; row[5] = 'Ads FB Mess'; row[10] = '02/10/2026';
  t.mock.method(globalThis, 'fetch', async url => {
    const source = new URL(String(url), 'https://local.test').searchParams.get('source');
    return { ok: true, json: async () => ({
      values: [row],
      identities: [{ recordId: 'derived-1', source: source === 'booked' ? 'leads' : source, sourceRow: 99, derived: source === 'booked', persisted: false }],
      metadata: { source, stale: false }
    }) };
  });
  const result = await fetchAllData('ignored');
  assert.equal(result.leads[0].source, 'Ads FB Mess');
  assert.equal(result.booked[0].source, 'Ads FB Mess');
  assert.equal(result.booked[0].sourceIdentity.source, 'leads');
  assert.equal(result.booked[0].provenance.derived, true);
  assert.equal(result.booked[0].sourceRow, 99);
});
