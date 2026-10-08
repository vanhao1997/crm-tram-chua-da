import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const entrypoint = readFileSync('src/main.js', 'utf8').replace(/^import .*;\r?\n/, '');
function harness(fetchOverview, saved = null, storageFails = false) {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        textContent: '', innerHTML: '', dataset: {}, value: '', checked: false, disabled: false,
        listeners: {}, attributes: {},
        classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key), toggle: (key, active) => active ? classes.add(key) : classes.delete(key) },
        addEventListener(type, callback) { this.listeners[type] = callback; },
        setAttribute(key, value) { this.attributes[key] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
        querySelector: key => element(`${id}:${key}`)
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    fetchOverview, AbortController, Date, Intl, Number, String, JSON,
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {}, hidden: false },
    navigator: { onLine: true },
    localStorage: { getItem: () => saved, setItem() { if (storageFails) throw new Error('Storage denied'); } },
    window: { setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {} }
  });
  vm.runInContext(entrypoint, context);
  const run = code => vm.runInContext(code, context);
  run('initDom(); setupEvents();');
  return { elements, element, timers, run, filter(key) { element('filterTabs').listeners.click({ target: { closest: () => ({ dataset: { filter: key } }) } }); } };
}
const aggregate = (leads, fetchedAt = new Date().toISOString()) => ({
  period: { key: 'month', start: '2026-10-01', end: '2026-10-31', actualEnd: '2026-10-06' },
  crm: { leads, appointments: 2, arrived: 0, revenue: 0 },
  marketing: { received: 10, cost: 5, balance: 5 },
  metadata: { fetchedAt, integrity: { issues: [] } }
});

test('overview ignores an older response after a period change and only latest request releases loading', async () => {
  const pending = [];
  const ui = harness(options => new Promise(resolve => pending.push({ resolve, options })));
  const first = ui.run('loadOverview()');
  ui.run("state.currentFilter = 'lastmonth'");
  const second = ui.run('loadOverview({ keepSamePeriodOnFailure: false })');
  assert.equal(pending[0].options.signal.aborted, true);
  pending[0].resolve(aggregate(99));
  await first;
  assert.equal(ui.element('loadingOverlay').classList.contains('active'), true);
  assert.notEqual(ui.element('crmLeads').textContent, '99');
  pending[1].resolve(aggregate(45));
  await second;
  assert.equal(ui.element('crmLeads').textContent, '45');
  assert.equal(ui.element('loadingOverlay').classList.contains('active'), false);
  assert.equal(ui.run('state.lastSignature'), 'lastmonth::');
});

test('overview timeout reports failure; same-period last-good retention uses source age and expires', async () => {
  const sourceAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  let handler = () => Promise.resolve(aggregate(15, sourceAt));
  const ui = harness(options => handler(options));
  await ui.run('loadOverview()');
  assert.equal(ui.run('state.lastRefresh'), Date.parse(sourceAt));
  handler = ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
    const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
  }));
  const retained = ui.run('loadOverview()');
  [...ui.timers.values()][0]();
  await retained;
  assert.equal(ui.element('crmLeads').textContent, '15');
  assert.equal(ui.element('dataStatusBar').dataset.status, 'stale');
  ui.run(`renderOverview(${JSON.stringify(aggregate(15, new Date(Date.now() - 16 * 60 * 1000).toISOString()))})`);
  const expired = ui.run('loadOverview()');
  [...ui.timers.values()][0]();
  await expired;
  assert.equal(ui.element('crmLeads').textContent, '—');
  assert.equal(ui.element('dataStatusBar').dataset.status, 'error');
  assert.match(ui.element('dataStatusBar:.data-status__text').textContent, /quá thời gian/);
  assert.equal(ui.element('refreshBtn').disabled, false);
});

test('invalid custom filters do not fetch, and denied storage does not break filter changes', async () => {
  let requests = 0;
  const ui = harness(async () => { requests++; return aggregate(15); }, JSON.stringify({ currentFilter: 'custom', customStart: '2026-02-30', customEnd: '2026-03-01' }), true);
  ui.run('readFilterState()');
  assert.equal(ui.run('state.currentFilter'), 'month');
  ui.filter('custom');
  await ui.run('loadOverview()');
  assert.equal(requests, 0);
  assert.equal(ui.element('dataStatusBar').dataset.status, 'warning');
  assert.equal(ui.element('crmLeads').textContent, '—');
  ui.element('dateStart').value = '2026-10-06';
  ui.element('dateEnd').value = '2026-10-05';
  ui.element('applyCustomDateBtn').listeners.click();
  assert.equal(requests, 0);
  assert.equal(ui.element('dataStatusBar').dataset.status, 'error');
  ui.filter('month');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(ui.element('crmLeads').textContent, '15');
});

test('appointment cards escape source text, collapse extra items and show past KPI without inferring no-shows', () => {
  const ui = harness(async () => aggregate(15));
  const item = { name: '<img src=x onerror=alert(1)>', service: '<script>bad()</script>',
    date: '2026-10-06', time: 'chưa báo', status: 'Đặt Hẹn', kind: 'scheduled', derived: true };
  const payload = {
    ...aggregate(15), crm: { ...aggregate(15).crm, pastAppointments: 3 },
    schedule: { available: true, stale: true, recentStart: '2026-09-30', recentEnd: '2026-10-06',
      upcoming: { total: 26, omitted: 20, items: Array(6).fill(item) },
      recentPast: { total: 1, omitted: 0, items: [{ ...item, visitRecorded: true, kind: 'completed' }] } }
  };
  ui.run(`renderOverview(${JSON.stringify(payload)})`);
  assert.equal(ui.element('crmPastAppointments').textContent, '3');
  const html = ui.element('upcomingAppointments').innerHTML;
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Xem thêm 1 lịch/);
  assert.match(html, /Hiển thị 6 \/ 26/);
  assert.match(ui.element('scheduleFreshness').textContent, /lịch gần nhất/);
  assert.match(ui.element('pastAppointmentSummary').textContent, /không đồng nghĩa khách chưa tới/);
  assert.match(ui.element('pastAppointments').innerHTML, /Có ghi nhận khách tới/);
  assert.match(ui.element('pastAppointments').innerHTML, /Đặt Hẹn/);
  ui.run('clearOverview()');
  assert.equal(ui.element('crmPastAppointments').textContent, '—');
  assert.equal(ui.element('upcomingCount').textContent, '—');
  assert.doesNotMatch(ui.element('upcomingAppointments').innerHTML, /onerror/);
});

test('empty and unavailable appointment lists have distinct states', () => {
  const ui = harness(async () => aggregate(15));
  ui.run(`renderSchedule(${JSON.stringify({ available: true, upcoming: { total: 0, items: [] }, recentPast: { total: 0, items: [] } })})`);
  assert.equal(ui.element('upcomingCount').textContent, '0');
  assert.match(ui.element('upcomingAppointments').innerHTML, /Chưa có lịch hẹn sắp tới/);
  ui.run('renderSchedule({ available: false })');
  assert.equal(ui.element('upcomingCount').textContent, '—');
  assert.match(ui.element('upcomingAppointments').innerHTML, /Chưa tải được lịch hẹn/);
});

test('cost / revenue displays percentages, uses the raw 30% threshold and clears previous colors', () => {
  const ui = harness(async () => aggregate(15));
  for (const [ratio, expectedText, expectedTone] of [
    [0.25, '25%', 'success'], [0.3, '30%', 'success'],
    [0.30004, '30%', 'danger'], [0.45, '45%', 'danger'],
    [0, '0%', 'success'], [null, '—', 'neutral']
  ]) {
    const payload = aggregate(15);
    payload.marketing = { ...payload.marketing, revenue: 1000, costRevenueRatio: ratio };
    ui.run(`renderOverview(${JSON.stringify(payload)})`);
    assert.equal(ui.element('mktCostRevenueRatio').textContent, expectedText);
    assert.equal(ui.element('mktCostRevenueRatio').dataset.tone, expectedTone);
  }
  ui.run('renderCostRevenueRatio({ revenue: 0, costRevenueRatio: null })');
  assert.match(ui.element('mktCostRevenueNote').textContent, /Doanh thu bằng 0/);
  assert.equal(ui.element('mktCostRevenueRatio').dataset.tone, 'neutral');
  ui.run('renderCostRevenueRatio({ costRevenueRatio: 0.4 }); clearOverview()');
  assert.equal(ui.element('mktCostRevenueRatio').textContent, '—');
  assert.equal(ui.element('mktCostRevenueRatio').dataset.tone, 'neutral');
});

test('cost comparison cards show distinct better/worse results and their exact prior dates and money', () => {
  const ui = harness(async () => aggregate(15));
  const payload = aggregate(15);
  payload.marketing.comparison = {
    period: { key: 'month', start: '2026-09-01', end: '2026-09-08' },
    costPerData: { previous: 200000, current: 150000, change: -0.25, direction: 'down', reason: null },
    costPerArrived: { previous: 1000000, current: 1250000, change: 0.25, direction: 'up', reason: null }
  };
  ui.run(`renderOverview(${JSON.stringify(payload)})`);
  assert.equal(ui.element('mktCostPerDataComparison').textContent, 'Giảm 25% · Tốt');
  assert.equal(ui.element('mktCostPerDataComparison').dataset.tone, 'success');
  assert.equal(ui.element('mktCostPerArrivedComparison').textContent, 'Tăng 25% · Xấu');
  assert.equal(ui.element('mktCostPerArrivedComparison').dataset.tone, 'danger');
  assert.match(ui.element('mktCostPerDataBaseline').textContent, /Cùng kỳ tháng trước \(01\/09\/2026 – 08\/09\/2026\): 200\.000 ₫/);
  ui.run('clearOverview()');
  assert.equal(ui.element('mktCostPerDataComparison').dataset.tone, 'neutral');
  assert.equal(ui.element('mktCostPerArrivedBaseline').textContent, '');
});

test('cost comparisons keep equal, zero baseline and unavailable states honest after period changes', () => {
  const ui = harness(async () => aggregate(15));
  for (const [metric, text, tone] of [
    [{ previous: 0, change: null, direction: 'up' }, 'Tăng · Xấu (kỳ trước bằng 0)', 'danger'],
    [{ previous: 100, change: 0, direction: 'flat' }, 'Không đổi so với kỳ trước', 'neutral'],
    [{ reason: 'no_period' }, 'Không có kỳ tương ứng để so sánh', 'neutral'],
    [{ reason: 'source_unavailable' }, 'Chưa so sánh: nguồn thiếu hoặc chưa cập nhật', 'neutral'],
    [{ reason: 'incomplete_days' }, 'Chưa so sánh: thiếu ngày hoặc có ngày trùng', 'neutral'],
    [{ reason: 'missing_metric' }, 'Chưa đủ dữ liệu để so sánh', 'neutral']
  ]) {
    ui.run(`renderCostComparisons(${JSON.stringify({ costPerData: metric, costPerArrived: metric })})`);
    assert.equal(ui.element('mktCostPerDataComparison').textContent, text);
    assert.equal(ui.element('mktCostPerArrivedComparison').dataset.tone, tone);
  }
});
