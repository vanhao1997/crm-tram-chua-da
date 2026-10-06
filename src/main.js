import { fetchOverview } from './core/api/overview-api.js';

const FILTER_STORAGE_KEY = 'bsn-overview-filter-v1';
const REFRESH_INTERVAL = 5 * 60 * 1000;
const RETAIN_LAST_GOOD_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

const els = {};
const state = {
  loading: false,
  currentFilter: 'month',
  customStart: '',
  customEnd: '',
  lastRefresh: null,
  lastSignature: null,
  requestId: 0,
  controller: null,
  autoRefreshTimer: null
};

function syncDisplayMode() {
  const standalone = navigator.standalone === true
    || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
  document.documentElement?.classList.toggle('is-standalone', standalone);
}

function readFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
    if (!saved || typeof saved !== 'object') return;
    if (['today', 'week', 'month', 'lastmonth', 'all', 'custom'].includes(saved.currentFilter)) {
      state.currentFilter = saved.currentFilter;
    }
    state.customStart = isDateKey(saved.customStart) ? saved.customStart : '';
    state.customEnd = isDateKey(saved.customEnd) ? saved.customEnd : '';
    if (state.currentFilter === 'custom' && !validCustomRange()) state.currentFilter = 'month';
  } catch {}
}

function saveFilterState() {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
      currentFilter: state.currentFilter,
      customStart: state.customStart,
      customEnd: state.customEnd
    }));
  } catch {}
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validCustomRange() {
  return isDateKey(state.customStart) && isDateKey(state.customEnd) && state.customStart <= state.customEnd;
}

function initDom() {
  for (const id of [
    'refreshBtn', 'lastRefresh', 'autoRefreshToggle', 'loadingOverlay',
    'dataStatusBar', 'activePeriodLabel', 'overviewFreshness', 'filterTabs',
    'customDatePicker', 'dateStart', 'dateEnd', 'applyCustomDateBtn',
    'crmLeads', 'crmAppointments', 'crmPastAppointments', 'crmArrived', 'crmRevenue',
    'crmAppointmentNote', 'mktReceived', 'mktCost', 'mktCostNote',
    'mktBalance', 'mktMessages', 'mktRoas', 'mktCostPerData',
    'mktCostPerArrived', 'issueList', 'issueSummary', 'scheduleFreshness',
    'upcomingCount', 'pastAppointmentCount', 'upcomingSummary',
    'pastAppointmentSummary', 'upcomingAppointments', 'pastAppointments'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function signature() {
  return `${state.currentFilter}:${state.customStart}:${state.customEnd}`;
}

function syncFilterTabs() {
  document.querySelectorAll('#filterTabs [data-filter]').forEach(tab => {
    const active = tab.dataset.filter === state.currentFilter;
    tab.classList.toggle('filter-tab--active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  if (els.customDatePicker) els.customDatePicker.hidden = state.currentFilter !== 'custom';
  if (els.dateStart) els.dateStart.value = state.customStart;
  if (els.dateEnd) els.dateEnd.value = state.customEnd;
  if (els.activePeriodLabel) els.activePeriodLabel.textContent = formatPeriodLabel();
}

function formatPeriodLabel() {
  if (state.currentFilter === 'today') return 'Đang xem: Hôm nay';
  if (state.currentFilter === 'week') return 'Đang xem: Tuần này';
  if (state.currentFilter === 'month') return 'Đang xem: Tháng này';
  if (state.currentFilter === 'lastmonth') return 'Đang xem: Tháng trước';
  if (state.currentFilter === 'all') return 'Đang xem: Toàn bộ dữ liệu';
  return validCustomRange()
    ? `Đang xem: ${formatDateKey(state.customStart)} đến ${formatDateKey(state.customEnd)}`
    : 'Đang xem: Tùy chọn ngày';
}

function showLoading() {
  state.loading = true;
  els.loadingOverlay?.classList.add('active');
  if (els.refreshBtn) {
    els.refreshBtn.disabled = true;
    els.refreshBtn.classList.add('refreshing');
    els.refreshBtn.setAttribute('aria-busy', 'true');
  }
}

function hideLoading() {
  state.loading = false;
  els.loadingOverlay?.classList.remove('active');
  if (els.refreshBtn) {
    els.refreshBtn.disabled = false;
    els.refreshBtn.classList.remove('refreshing');
    els.refreshBtn.removeAttribute('aria-busy');
  }
}

function setStatus(kind, message) {
  if (!els.dataStatusBar) return;
  els.dataStatusBar.dataset.status = kind;
  const text = els.dataStatusBar.querySelector('.data-status__text');
  if (text) text.textContent = message;
}

function setText(id, value) {
  if (els[id]) els[id].textContent = value;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

function formatDateKey(value) {
  return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : 'không giới hạn';
}

function formatNumber(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

function formatMoney(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : `${Math.round(Number(value)).toLocaleString('vi-VN')} ₫`;
}

function formatRatio(value, suffix = 'x') {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}${suffix}`;
}

function clearOverview() {
  for (const id of [
    'crmLeads', 'crmAppointments', 'crmPastAppointments', 'crmArrived', 'crmRevenue',
    'mktReceived', 'mktCost', 'mktBalance', 'mktMessages',
    'mktRoas', 'mktCostPerData', 'mktCostPerArrived'
  ]) setText(id, '—');
  setText('crmAppointmentNote', 'Theo ngày hẹn, gồm lịch tương lai trong kỳ');
  setText('mktCostNote', 'Ads + phí quản lý');
  setText('overviewFreshness', 'Chưa có dữ liệu mới cho kỳ đang xem.');
  setText('issueSummary', 'Chưa có dữ liệu đối soát');
  if (els.issueList) els.issueList.innerHTML = '<li class="issue-item">Chưa có cảnh báo để hiển thị.</li>';
  renderSchedule();
}

function renderSchedule(schedule) {
  const available = schedule?.available === true;
  setText('upcomingCount', available ? formatNumber(schedule.upcoming?.total) : '—');
  setText('pastAppointmentCount', available ? formatNumber(schedule.recentPast?.total) : '—');
  setText('scheduleFreshness', available
    ? `Theo hôm nay, độc lập với bộ lọc số liệu.${schedule.stale ? ' Đang dùng lịch gần nhất, chưa cập nhật được nguồn mới.' : ''}`
    : 'Chưa có nguồn CRM để xác nhận lịch hẹn.');
  setText('upcomingSummary', 'Lịch gần nhất xếp trước; lịch chưa rõ giờ hôm nay vẫn giữ ở đây.');
  setText('pastAppointmentSummary', available
    ? `${formatDateKey(schedule.recentStart)} đến ${formatDateKey(schedule.recentEnd)}. Đã qua giờ hẹn không đồng nghĩa khách chưa tới.`
    : 'Đã qua giờ hẹn không đồng nghĩa khách chưa tới.');
  for (const [id, group, emptyMessage] of [
    ['upcomingAppointments', schedule?.upcoming, 'Chưa có lịch hẹn sắp tới.'],
    ['pastAppointments', schedule?.recentPast, 'Không có lịch hẹn đã qua trong 7 ngày gần nhất.']
  ]) {
    if (!els[id]) continue;
    const items = Array.isArray(group?.items) ? group.items : [];
    if (!available || !items.length) {
      els[id].innerHTML = `<li class="appointment-empty">${available ? emptyMessage : 'Chưa tải được lịch hẹn.'}</li>`;
      continue;
    }
    const renderItem = item => {
      const kind = ['completed', 'canceled', 'rescheduled'].includes(item.kind) ? item.kind : 'scheduled';
      const day = formatDateKey(item.date);
      return `<li class="appointment-item"><div class="appointment-when"><strong>${escapeHtml(day.slice(0, 5))}</strong><span>${escapeHtml(day.slice(6))}</span><span>${escapeHtml(item.time || 'Chưa rõ giờ')}</span></div><div class="appointment-info"><strong class="appointment-name">${escapeHtml(item.name || 'Chưa có tên')}</strong><span class="appointment-service">${escapeHtml(item.service || 'Chưa ghi dịch vụ')}</span><div class="appointment-tags"><span class="appointment-tag appointment-tag--${kind}">${escapeHtml(item.status || 'Chưa rõ trạng thái')}</span>${item.visitRecorded ? '<span class="appointment-tag appointment-tag--completed">Có ghi nhận khách tới</span>' : ''}${item.timeConfirmed ? '' : '<span class="appointment-tag">Chưa rõ giờ</span>'}</div>${item.derived ? '<span class="appointment-provenance">Từ lead xác nhận</span>' : ''}</div></li>`;
    };
    const extra = items.length > 5
      ? `<li><details class="appointment-more"><summary>Xem thêm ${formatNumber(items.length - 5)} lịch</summary><ol class="appointment-list">${items.slice(5).map(renderItem).join('')}</ol></details></li>` : '';
    const omitted = group.omitted > 0
      ? `<li class="appointment-more">Hiển thị ${formatNumber(items.length)} / ${formatNumber(group.total)} lịch gần nhất.</li>` : '';
    els[id].innerHTML = items.slice(0, 5).map(renderItem).join('') + extra + omitted;
  }
}

function statusFromOverview(overview) {
  const issues = overview?.metadata?.integrity?.issues || [];
  if (issues.some(issue => issue.severity === 'critical')) {
    return { kind: 'error', message: 'Có cảnh báo dữ liệu nghiêm trọng trong kỳ đang xem.' };
  }
  if (overview?.metadata?.partial) return { kind: 'warning', message: 'Một phần nguồn dữ liệu chưa sẵn sàng, số liên quan đang để trống.' };
  if (overview?.metadata?.stale) return { kind: 'stale', message: 'Đang dùng dữ liệu gần nhất, chờ lần đồng bộ mới.' };
  if (issues.length) return { kind: 'warning', message: 'Có cảnh báo dữ liệu cần kiểm tra trong kỳ đang xem.' };
  return { kind: 'success', message: 'Dữ liệu tổng quan đã cập nhật.' };
}

function renderFreshness(overview) {
  const period = overview.period || {};
  const fetched = overview.metadata?.fetchedAt ? formatDateTime(overview.metadata.fetchedAt) : 'chưa rõ';
  const range = period.key === 'all' ? 'Toàn bộ dữ liệu' : `Kỳ ${formatDateKey(period.start)} đến ${formatDateKey(period.end)}`;
  const actual = formatDateKey(period.actualEnd);
  const sourceState = overview.metadata?.partial
    ? 'một phần nguồn chưa sẵn sàng'
    : overview.metadata?.stale ? 'đang dùng dữ liệu gần nhất' : 'đã cập nhật';
  setText('overviewFreshness', `${range}, ghi nhận đến ${actual}. Cập nhật ${fetched}, ${sourceState}.`);
}

function renderIssues(integrity = {}) {
  const issues = Array.isArray(integrity.issues) ? integrity.issues : [];
  setText('issueSummary', issues.length ? `${issues.length} nhóm cảnh báo trong kỳ` : 'Không có cảnh báo trong kỳ đang xem');
  if (!els.issueList) return;
  if (!issues.length) {
    els.issueList.innerHTML = '<li class="issue-item issue-item--ok">Không có cảnh báo toàn vẹn dữ liệu trong kỳ này.</li>';
    return;
  }
  els.issueList.innerHTML = issues.map(issue => {
    const className = issue.severity === 'critical' ? 'issue-item issue-item--critical' : 'issue-item';
    const count = Number(issue.count) > 1 ? ` (${Number(issue.count).toLocaleString('vi-VN')})` : '';
    return `<li class="${className}"><strong>${issue.severity === 'critical' ? 'Cần kiểm tra' : 'Lưu ý'}${count}</strong><span>${escapeHtml(issue.message || 'Cần kiểm tra nguồn dữ liệu.')}</span></li>`;
  }).join('');
}

function renderOverview(overview) {
  const crm = overview.crm || {};
  const marketing = overview.marketing || {};
  setText('crmLeads', formatNumber(crm.leads));
  setText('crmAppointments', formatNumber(crm.appointments));
  setText('crmPastAppointments', formatNumber(crm.pastAppointments));
  setText('crmArrived', formatNumber(crm.arrived));
  setText('crmRevenue', formatMoney(crm.revenue));
  setText('crmAppointmentNote', Number(crm.derivedAppointments) > 0
    ? `Có ${formatNumber(crm.derivedAppointments)} lịch hẹn suy ra từ lead đã đặt hẹn`
    : 'Theo ngày hẹn, gồm lịch tương lai trong kỳ');

  setText('mktReceived', formatMoney(marketing.received));
  setText('mktCost', formatMoney(marketing.cost));
  setText('mktCostNote', `Ads ${formatMoney(marketing.ads)} · phí quản lý ${formatMoney(marketing.fee)}`);
  setText('mktBalance', formatMoney(marketing.balance));
  setText('mktMessages', formatNumber(marketing.messages));
  setText('mktRoas', formatRatio(marketing.roas));
  setText('mktCostPerData', formatMoney(marketing.costPerData));
  setText('mktCostPerArrived', formatMoney(marketing.costPerArrived));

  renderFreshness(overview);
  renderSchedule(overview.schedule);
  renderIssues(overview.metadata?.integrity);
  const status = statusFromOverview(overview);
  setStatus(status.kind, status.message);
  state.lastRefresh = overview.metadata?.fetchedAt ? Date.parse(overview.metadata.fetchedAt) : Date.now();
  if (els.lastRefresh) els.lastRefresh.textContent = formatDateTime(state.lastRefresh).slice(11);
}

async function loadOverview({ keepSamePeriodOnFailure = true } = {}) {
  if (state.currentFilter === 'custom' && !validCustomRange()) {
    clearOverview();
    setStatus('warning', 'Chọn ngày bắt đầu và kết thúc rồi nhấn Lọc.');
    return;
  }
  const requestSignature = signature();
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  showLoading();
  try {
    const overview = await fetchOverview({
      period: state.currentFilter,
      from: state.customStart,
      to: state.customEnd,
      signal: controller.signal
    });
    if (requestId !== state.requestId || controller.signal.aborted) return;
    if (requestSignature !== signature()) return;
    state.lastSignature = requestSignature;
    renderOverview(overview);
  } catch (error) {
    if (requestId !== state.requestId) return;
    const canKeep = keepSamePeriodOnFailure
      && state.lastSignature === requestSignature
      && Date.now() - (state.lastRefresh || 0) <= RETAIN_LAST_GOOD_MS;
    if (!canKeep) clearOverview();
    const message = error.name === 'AbortError' && timedOut ? 'yêu cầu quá thời gian' : error.message;
    setStatus(canKeep ? 'stale' : 'error', canKeep
      ? 'Không tải được dữ liệu mới, đang giữ số của cùng kỳ trong tối đa 15 phút.'
      : `Không tải được dữ liệu tổng quan: ${message}`);
  } finally {
    window.clearTimeout(timeout);
    if (requestId === state.requestId) hideLoading();
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshTimer = window.setInterval(() => {
    if (!document.hidden && navigator.onLine) loadOverview();
  }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
}

function setupEvents() {
  els.refreshBtn?.addEventListener('click', () => loadOverview());
  els.autoRefreshToggle?.addEventListener('change', event => {
    if (event.target.checked) startAutoRefresh();
    else stopAutoRefresh();
  });
  els.filterTabs?.addEventListener('click', event => {
    const tab = event.target.closest('[data-filter]');
    if (!tab) return;
    state.currentFilter = tab.dataset.filter;
    saveFilterState();
    syncFilterTabs();
    if (state.currentFilter === 'custom' && !validCustomRange()) {
      state.requestId += 1;
      state.controller?.abort();
      hideLoading();
      clearOverview();
      setStatus('warning', 'Chọn ngày bắt đầu và kết thúc rồi nhấn Lọc.');
      return;
    }
    loadOverview({ keepSamePeriodOnFailure: false });
  });
  els.applyCustomDateBtn?.addEventListener('click', () => {
    const start = els.dateStart?.value || '';
    const end = els.dateEnd?.value || '';
    if (!isDateKey(start) || !isDateKey(end) || start > end) {
      setStatus('error', 'Chọn ngày bắt đầu và kết thúc hợp lệ.');
      return;
    }
    state.currentFilter = 'custom';
    state.customStart = start;
    state.customEnd = end;
    saveFilterState();
    syncFilterTabs();
    loadOverview({ keepSamePeriodOnFailure: false });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine && Date.now() - (state.lastRefresh || 0) > REFRESH_INTERVAL) loadOverview();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function init() {
  readFilterState();
  initDom();
  setupEvents();
  syncFilterTabs();
  clearOverview();
  loadOverview({ keepSamePeriodOnFailure: false });
  if (els.autoRefreshToggle?.checked) startAutoRefresh();
}

syncDisplayMode();
document.addEventListener('DOMContentLoaded', init);
