import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { deriveCustomers, hasConfirmedTime, isUpcomingAppointment, sortAppointments } from '../../features/dashboard/ui-helpers.js';
import { chart } from '../../features/dashboard/budget-view.js';
import { fetchAllData } from '../api/sheets-api.js';
test('frontend entrypoint parses (unit suites alone do not bundle it)', () => {
  execFileSync(process.execPath, ['--check', 'src/main.js']);
});
test('invalid calendar input cannot roll into another month', async t => {
  const row = date => { const r = Array(23).fill(''); r[1] = date; r[2] = 'Test'; r[10] = date; return r; };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ values: [row('31/02/2026'), row('29/02/2024'), row('Date(2026,1,31)'), row('00/09/2026')] }) }));
  const data = await fetchAllData('ignored');
  assert.ok(data.leads.every(r => !r.date || (r.date.getFullYear() === 2024 && r.date.getMonth() === 1 && r.date.getDate() === 29)));
  assert.ok(data.leads.some(r => r.date?.getFullYear() === 2024));
});
test('upcoming includes later today, excludes elapsed time, retains unknown time', () => {
  const now = new Date(2026, 8, 10, 14);
  const apt = time => ({ aptDate: new Date(2026, 8, 10), time });
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
