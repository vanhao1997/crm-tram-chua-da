/**
 * BSN CRM Dashboard
 * UI orchestration for the original two-page dashboard.
 *
 * The page remains read-only. Google Sheets writes are intentionally not
 * imported here; operational changes happen in the source Sheet.
 */

import {
    parseSheetUrl,
    fetchAllData,
    fetchMarketingData,
    normalizeStatus,
    formatCurrency,
    formatDateShort,
    formatDateFull
} from './core/api/sheets-api.js';
import { getOverdueAppointments, renderOverdueList } from './features/appointments/appointments.js';
import { renderBudgetView } from './features/dashboard/budget-view.js';
import { readTelegramGroup } from './features/dashboard/telegram-settings.js';
import { dateKey } from './core/analytics/budget-intelligence.js';
import { initAppShell, restoreScroll } from './features/dashboard/app-shell.js';
import {
    renderKPICards,
    renderFunnelChart,
    renderRevenueChart,
    renderStatusChart,
    renderRevenuePieChart,
    renderMarketingFunnelChart,
    renderMarketingPieCharts
} from './features/dashboard/charts.js';
import {
    deriveCustomers,
    formatPhone,
    getDisplayStatus,
    getDateRange,
    hasConfirmedTime,
    isUpcomingAppointment,
    inDateFilter,
    latestRecordDate,
    normalizePhone,
    searchRecords,
    sortAppointments,
    toDate
} from './features/dashboard/ui-helpers.js';

const CRM_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1HEOYV5QzcOAHSMr6x5zeuem1Vi3V9QdeTvF6lKhGLgk/edit?usp=sharing';
const MARKETING_SHEET_URL = 'https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/edit?gid=1227076939#gid=1227076939';
const FILTER_STORAGE_KEY = 'bsn-crm-filter-v2';
const REFRESH_INTERVAL = 5 * 60 * 1000;

const persistedFilter = readFilterState();
const state = {
    sheetId: parseSheetUrl(CRM_SHEET_URL),
    marketingSheetId: parseSheetUrl(MARKETING_SHEET_URL),
    data: null,
    marketingData: null,
    dataMeta: null,
    marketingMeta: null,
    currentFilter: persistedFilter.currentFilter || 'month',
    customStart: persistedFilter.customStart || '',
    customEnd: persistedFilter.customEnd || '',
    recordView: ['appointments', 'leads', 'customers'].includes(persistedFilter.recordView) ? persistedFilter.recordView : 'appointments',
    tableSearch: '',
    serviceFilter: persistedFilter.serviceFilter || 'all',
    statusFilter: persistedFilter.statusFilter || 'all',
    loading: false,
    autoRefreshInterval: null,
    lastRefresh: null,
    lastFocusedElement: null,
    tableRecords: [],
    drilldownRecords: [],
    activeRecordType: 'appointments',
    currentDetail: null,
    lastBudgetModel: null
};

const els = {};

function readFilterState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveFilterState() {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        currentFilter: state.currentFilter,
        customStart: state.customStart,
        customEnd: state.customEnd,
        recordView: state.recordView,
        serviceFilter: state.serviceFilter,
        statusFilter: state.statusFilter
    }));
}

function initDom() {
    els.refreshBtn = document.getElementById('refreshBtn');
    els.telegramShareBtn = document.getElementById('telegramShareBtn');
    els.lastRefresh = document.getElementById('lastRefresh');
    els.autoRefreshToggle = document.getElementById('autoRefreshToggle');
    els.loadingOverlay = document.getElementById('loadingOverlay');
    els.welcomeScreen = document.getElementById('welcomeScreen');
    els.dashboard = document.getElementById('dashboard');
    els.marketing = document.getElementById('marketing');
    els.toastContainer = document.getElementById('toastContainer');
    els.globalSearch = document.getElementById('globalSearch');
    els.tableSearch = document.getElementById('tableSearch');
    els.serviceFilter = document.getElementById('serviceFilter');
    els.statusFilter = document.getElementById('statusFilter');
    els.customDatePicker = document.getElementById('customDatePicker');
    els.dateStart = document.getElementById('dateStart');
    els.dateEnd = document.getElementById('dateEnd');
    els.applyCustomDateBtn = document.getElementById('applyCustomDateBtn');
    els.dataStatusBar = document.getElementById('dataStatusBar');
    els.activePeriodLabel = document.getElementById('activePeriodLabel');
    syncFilterTabs();
}

window.showToast = function showToast(message, type = 'info') {
    if (!els.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    window.setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-out forwards';
        window.setTimeout(() => toast.remove(), 300);
    }, 3200);
};

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

function setDataStatus(kind, message, meta = {}) {
    if (!els.dataStatusBar) return;
    els.dataStatusBar.dataset.status = kind;
    const text = els.dataStatusBar.querySelector('.data-status__text');
    if (text) text.textContent = message;
    const dot = els.dataStatusBar.querySelector('.data-status__dot');
    if (dot) dot.setAttribute('aria-label', kind);
    if (meta.fetchedAt) els.dataStatusBar.title = `Cập nhật ${formatDateTime(meta.fetchedAt)}`;
}

function formatDateTime(value) {
    const date = toDate(value);
    if (!date) return '--';
    return `${formatDateFull(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatPeriodLabel() {
    if (state.currentFilter === 'today') return 'Hôm nay';
    if (state.currentFilter === 'week') return 'Tuần này';
    if (state.currentFilter === 'month') return 'Tháng này';
    if (state.currentFilter === 'lastmonth') return 'Tháng trước';
    if (state.currentFilter === 'upcoming') return 'Lịch sắp tới';
    if (state.currentFilter === 'all') return 'Toàn bộ dữ liệu';
    if (state.currentFilter === 'custom') {
        if (state.customStart || state.customEnd) return `${state.customStart || 'Đầu kỳ'} đến ${state.customEnd || 'Cuối kỳ'}`;
        return 'Khoảng tùy chọn';
    }
    return 'Tháng này';
}

function syncFilterTabs() {
    document.querySelectorAll('#filterTabs .filter-tab').forEach(tab => {
        const active = tab.dataset.filter === state.currentFilter;
        tab.classList.toggle('filter-tab--active', active);
        tab.setAttribute('aria-pressed', String(active));
    });
    if (els.customDatePicker) {
        els.customDatePicker.style.display = state.currentFilter === 'custom' ? 'flex' : 'none';
    }
    if (els.dateStart) els.dateStart.value = state.customStart;
    if (els.dateEnd) els.dateEnd.value = state.customEnd;
    if (els.activePeriodLabel) els.activePeriodLabel.textContent = `Đang xem: ${formatPeriodLabel()}`;
}

function filterByDate(records, field) {
    return (records || []).filter(record => state.currentFilter === 'upcoming' && field === 'aptDate' ? isUpcomingAppointment(record) : inDateFilter(
        record?.[field],
        state.currentFilter,
        state.customStart,
        state.customEnd
    ));
}

function filterByListControls(records) {
    let result = searchRecords(records, state.tableSearch);
    if (state.serviceFilter !== 'all') {
        result = result.filter(record => String(record?.service || '').trim() === state.serviceFilter);
    }
    if (state.statusFilter !== 'all') {
        result = result.filter(record => normalizeStatus(record?.status) === state.statusFilter);
    }
    return result;
}

async function connectSheet() {
    try {
        await loadData();
    } catch (error) {
        console.error('Connect error:', error);
    }
}

async function loadData() {
    if (state.loading) return;
    showLoading();
    els.welcomeScreen?.style.setProperty('display', 'none');
    if (els.dashboard) els.dashboard.style.display = 'flex';
    if (els.marketing) els.marketing.style.display = 'flex';

    let loaded = false;
    state.refreshFailed = false;
    try {
        if (els.dashboard) {
            const [crmResult, marketingResult] = await Promise.allSettled([
                fetchAllData(state.sheetId), fetchMarketingData(state.marketingSheetId)
            ]);
            state.crmMarketingFailed = marketingResult.status !== 'fulfilled';
            if (!state.crmMarketingFailed) {
                state.marketingData = marketingResult.value;
                state.marketingMeta = marketingResult.value.metadata || {};
            }
            renderCrmMarketingCards();
            if (crmResult.status !== 'fulfilled') throw crmResult.reason;
            const payload = crmResult.value;
            state.data = Array.isArray(payload)
                ? { leads: [], booked: [], arrived: [], metadata: {} }
                : payload;
            state.dataMeta = state.data?.metadata || {};
            loaded = true;
            renderDashboard();
        } else if (els.marketing) {
            const [marketingResult, crmResult] = await Promise.allSettled([
                fetchMarketingData(state.marketingSheetId), fetchAllData(state.sheetId)
            ]);
            if (marketingResult.status !== 'fulfilled') throw marketingResult.reason;
            const payload = marketingResult.value;
            state.budgetCrm = crmResult.status === 'fulfilled' ? crmResult.value : null;
            state.marketingData = Array.isArray(payload) ? payload : (payload?.rows || []);
            state.marketingMeta = payload?.metadata || state.marketingData?.metadata || {};
            loaded = true;
            renderMarketingDashboard();
        }

        state.lastRefresh = new Date();
        if (els.lastRefresh) {
            els.lastRefresh.textContent = `${String(state.lastRefresh.getHours()).padStart(2, '0')}:${String(state.lastRefresh.getMinutes()).padStart(2, '0')}`;
        }
        const metadata = state.dataMeta || state.marketingMeta || {};
        const stale = Boolean(metadata.stale || metadata.status === 'stale');
        setDataStatus(stale ? 'stale' : 'success', stale
            ? 'Đang hiển thị dữ liệu gần nhất'
            : 'Dữ liệu đã cập nhật', metadata);
    } catch (error) {
        state.refreshFailed = true;
        console.error('Load error:', error);
        const hasLastGood = Boolean(els.dashboard ? state.data : state.marketingData);
        setDataStatus(hasLastGood ? 'stale' : 'error', hasLastGood
            ? 'Không tải được bản mới, đang giữ dữ liệu gần nhất'
            : 'Không thể tải dữ liệu');
        if (!hasLastGood) {
            els.welcomeScreen?.style.setProperty('display', 'flex');
            window.showToast(`Lỗi tải dữ liệu: ${error.message}`, 'error');
        } else {
            if (els.dashboard) renderDashboard();
            if (els.marketing) renderMarketingDashboard();
            window.showToast('Dữ liệu mới chưa sẵn sàng; đang hiển thị lần tải gần nhất', 'error');
        }
    } finally {
        hideLoading();
        if (loaded) syncFilterTabs();
        if (loaded) restoreScroll();
    }
}

function updateServiceOptions(records) {
    if (!els.serviceFilter) return;
    const values = [...new Set((records || []).map(record => String(record?.service || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    const current = state.serviceFilter;
    els.serviceFilter.innerHTML = '<option value="all">Tất cả dịch vụ</option>' +
        values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    els.serviceFilter.value = values.includes(current) ? current : 'all';
    state.serviceFilter = els.serviceFilter.value;
}

function updateStatusOptions(records) {
    if (!els.statusFilter) return;
    const values = [...new Set((records || []).map(record => normalizeStatus(record?.status)).filter(status => status !== 'unknown'))]
        .sort();
    const labels = {
        booked: 'Đặt hẹn',
        arrived: 'Đã đến',
        rescheduled: 'Dời lịch',
        cancelled: 'Hủy lịch',
        no_answer: 'Không nghe máy',
        disconnected: 'Thuê bao',
        failed: 'Không hoàn thành',
        other: 'Khác'
    };
    els.statusFilter.innerHTML = '<option value="all">Tất cả trạng thái</option>' +
        values.map(value => `<option value="${value}">${labels[value] || value}</option>`).join('');
    els.statusFilter.value = values.includes(state.statusFilter) ? state.statusFilter : 'all';
    state.statusFilter = els.statusFilter.value;
}

function renderCrmMarketingCards() {
    const raw = state.marketingData;
    const stale = state.crmMarketingFailed || state.marketingMeta?.stale || state.marketingMeta?.status === 'stale';
    setText('crmMktStatus', !raw ? 'Chưa tải được Marketing. Nhấn tải lại để thử lại.'
        : `Nguồn: Sheet 2026 · ${formatPeriodLabel()}${stale ? ' · Dữ liệu gần nhất, chưa cập nhật được' : ''}`);
    if (!raw) return;
    const rows = raw.filter(item => inDateFilter(item.date, state.currentFilter, state.customStart, state.customEnd))
        .filter(item => toDate(item.date) && toDate(item.date) <= new Date());
    const cost = sumMetric(rows, 'cost');
    const revenue = sumMetric(rows, 'revenue');
    const ratio = cost.hasValue && revenue.hasValue && revenue.value > 0 ? cost.value / revenue.value * 100 : null;
    setMetric('crmMktReceived', officialMetric(raw, state.marketingMeta, 'globalReceived'));
    setMetric('crmMktBalance', officialMetric(raw, state.marketingMeta, 'globalBalance'));
    setMetric('crmMktCost', cost);
    setMetric('crmMktCostRatio', { hasValue: ratio !== null, value: ratio }, value => `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`);
}

function renderDashboard() {
    renderCrmMarketingCards();
    if (!state.data) return;
    const leads = filterByDate(state.data.leads, 'date');
    const booked = filterByDate(state.data.booked, 'aptDate');
    const arrived = (state.data.arrived || []).filter(record => inDateFilter(record?.date || record?.aptDate, state.currentFilter, state.customStart, state.customEnd));

    renderKPICards(leads, booked, arrived);
    renderFunnelChart(leads, booked, arrived);
    renderRevenueChart(arrived);
    renderStatusChart(leads);
    renderRevenuePieChart(arrived);

    const overdue = getOverdueAppointments(state.data.booked || [], state.data.arrived || []);
    renderOverdueList(overdue);
    const allRecords = [...state.data.leads, ...state.data.booked, ...state.data.arrived];
    updateServiceOptions(allRecords);
    updateStatusOptions(allRecords);
    renderRecordTable();
    bindKpiDrilldowns({ leads, booked, arrived });
}

function renderRecordTable() {
    document.querySelectorAll('#recordTabs [data-record-view]').forEach(tab => {
        const active = tab.dataset.recordView === state.recordView;
        tab.classList.toggle('record-tab--active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    const table = document.getElementById('appointmentTable');
    const head = table?.querySelector('thead');
    const body = document.getElementById('appointmentBody');
    const empty = document.getElementById('appointmentEmpty');
    const count = document.getElementById('tableResultCount');
    if (!table || !head || !body || !state.data) return;

    let records = [];
    if (state.recordView === 'leads') {
        records = filterByListControls(filterByDate(state.data.leads, 'date'))
            .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
        setTableTitle('Lead');
        head.innerHTML = `
            <tr><th>STT</th><th>Khách hàng</th><th>SĐT</th><th>Dịch vụ</th><th>Nguồn</th><th>Ngày nhận</th><th>Trạng thái</th><th>Thao tác</th></tr>
        `;
        body.innerHTML = records.map((record, index) => renderLeadRow(record, index)).join('');
    } else if (state.recordView === 'customers') {
        records = deriveCustomers(state.data)
            .filter(customer => inDateFilter(customer.latestDate, state.currentFilter, state.customStart, state.customEnd))
            .filter(customer => state.tableSearch ? searchRecords([customer], state.tableSearch).length : true)
            .filter(customer => state.serviceFilter === 'all' || [...(customer.services || [])].includes(state.serviceFilter) || customer.service === state.serviceFilter)
            .filter(customer => state.statusFilter === 'all' || normalizeStatus(customer.status) === state.statusFilter);
        setTableTitle('Khách hàng');
        head.innerHTML = `
            <tr><th>STT</th><th>Khách hàng</th><th>SĐT</th><th>Dịch vụ quan tâm</th><th>Trạng thái</th><th>Lần tương tác gần nhất</th><th>Doanh thu</th><th>Thao tác</th></tr>
        `;
        body.innerHTML = records.map((record, index) => renderCustomerRow(record, index)).join('');
    } else {
        records = sortAppointments(filterByListControls(filterByDate(state.data.booked, 'aptDate')));
        setTableTitle('Lịch hẹn');
        head.innerHTML = `
            <tr><th>STT</th><th>Khách hàng</th><th>SĐT</th><th>Dịch vụ</th><th>Giờ hẹn</th><th>Ngày hẹn</th><th>Trạng thái</th><th>Thao tác</th><th>Telegram</th></tr>
        `;
        body.innerHTML = records.map((record, index) => renderAppointmentRow(record, index)).join('');
    }

    state.tableRecords = records;
    state.activeRecordType = state.recordView;
    table.style.display = records.length ? '' : 'none';
    if (empty) {
        empty.style.display = records.length ? 'none' : 'flex';
        const text = empty.querySelector('p');
        if (text) text.textContent = 'Không có bản ghi trong khoảng đang xem';
    }
    if (count) count.textContent = `${records.length.toLocaleString('vi-VN')} bản ghi`;
    renderMobileRecords();
}

function renderMobileRecords() {
    const wrapper = document.getElementById('appointmentTableWrapper');
    if (!wrapper) return;
    let container = document.getElementById('mobileRecords');
    if (!container) {
        container = document.createElement('div');
        container.id = 'mobileRecords';
        container.className = 'mobile-records';
        wrapper.after(container);
    }
    const records = state.tableRecords || [];
    const type = state.activeRecordType || 'appointments';
    container.innerHTML = records.slice(0, 20).map((record, index) => {
        const date = type === 'customers' ? record.latestDate : type === 'appointments' ? record.aptDate : record.date;
        const when = type === 'appointments' && hasConfirmedTime(record) ? `${record.time} · ` : '';
        return `<article class="mobile-record-card" data-mobile-index="${index}">
          <header><h3>${escapeHtml(record.name || 'Chưa có tên')}</h3><span class="badge">${escapeHtml(getDisplayStatus(record))}</span></header>
          <div class="mobile-record-meta"><strong>${when}${escapeHtml(formatDateFull(toDate(date)))}</strong><span>${escapeHtml(record.service || 'Chưa xác định dịch vụ')}</span>${record.phone ? `<span>${escapeHtml(formatPhone(normalizePhone(record.phone) || record.phone))}</span>` : '<span class="missing-value">Chưa có số điện thoại</span>'}</div>
          <div class="mobile-record-actions">${renderCopyAction(index, type, 'Copy thông tin')}${renderTelegramAction(index, type)}</div>
        </article>`;
    }).join('') + (records.length > 20 ? '<button class="btn mobile-more" type="button" disabled>Hiển thị 20 bản ghi đầu</button>' : '');
}

function setTableTitle(label) {
    const title = document.querySelector('.appointments-panel .panel-title');
    if (!title) return;
    const textNodes = [...title.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
    const textNode = textNodes[textNodes.length - 1];
    if (textNode) textNode.nodeValue = ` ${label}`;
}

function renderAppointmentRow(record, index) {
    const phone = normalizePhone(record.phone);
    const status = getDisplayStatus(record);
    const statusClass = normalizeStatus(record.status);
    return `
      <tr data-record-index="${index}" data-record-type="appointments" tabindex="0">
        <td data-label="STT">${index + 1}</td>
        <td class="td-name" data-label="Khách hàng">${escapeHtml(record.name || 'Chưa có tên')}</td>
        <td class="td-phone" data-label="SĐT">${renderPhone(record.phone)}</td>
        <td class="td-service" data-label="Dịch vụ">${escapeHtml(record.service || 'Chưa xác định')}</td>
        <td data-label="Giờ hẹn"><span class="${hasConfirmedTime(record) ? '' : 'time-unknown'}">${hasConfirmedTime(record) ? escapeHtml(record.time) : 'Chưa xác định'}</span></td>
        <td data-label="Ngày hẹn">${formatDateFull(toDate(record.aptDate))}</td>
        <td data-label="Trạng thái"><span class="badge badge--${statusClass}">${escapeHtml(status)}</span></td>
        <td data-label="Thao tác">${renderCopyAction(index, "appointments", "Copy thông tin lịch hẹn")}</td>
        <td data-label="Telegram">${renderTelegramAction(index, "appointments")}</td>
      </tr>
    `;
}

function renderLeadRow(record, index) {
    const status = getDisplayStatus(record);
    const statusClass = normalizeStatus(record.status);
    return `
      <tr data-record-index="${index}" data-record-type="leads" tabindex="0">
        <td data-label="STT">${index + 1}</td>
        <td class="td-name" data-label="Khách hàng">${escapeHtml(record.name || 'Chưa có tên')}</td>
        <td class="td-phone" data-label="SĐT">${renderPhone(record.phone)}</td>
        <td class="td-service" data-label="Dịch vụ">${escapeHtml(record.service || 'Chưa xác định')}</td>
        <td data-label="Nguồn">${escapeHtml(record.source || 'Chưa xác định')}</td>
        <td data-label="Ngày nhận">${formatDateFull(toDate(record.date))}</td>
        <td data-label="Trạng thái"><span class="badge badge--${statusClass}">${escapeHtml(status)}</span></td>
        <td data-label="Thao tác">${renderRowActions(record, index, false)}${renderTelegramAction(index, "leads")}</td>
      </tr>
    `;
}

function renderCustomerRow(record, index) {
    const statusClass = normalizeStatus(record.status);
    return `
      <tr data-record-index="${index}" data-record-type="customers" tabindex="0">
        <td data-label="STT">${index + 1}</td>
        <td class="td-name" data-label="Khách hàng">${escapeHtml(record.name || 'Chưa có tên')}</td>
        <td class="td-phone" data-label="SĐT">${renderPhone(record.phone)}</td>
        <td class="td-service" data-label="Dịch vụ quan tâm">${escapeHtml(record.service || 'Chưa xác định')}</td>
        <td data-label="Trạng thái"><span class="badge badge--${statusClass}">${escapeHtml(record.status || 'Chưa xác định')}</span></td>
        <td data-label="Lần tương tác gần nhất">${formatDateFull(record.latestDate)}</td>
        <td data-label="Doanh thu">${Number.isFinite(Number(record.revenue)) && record.revenue !== null ? money(record.revenue) : '—'}</td>
        <td data-label="Thao tác">${renderTelegramAction(index, "customers")}</td>
      </tr>
    `;
}

function renderPhone(value) {
    const phone = normalizePhone(value);
    if (!phone) return '<span class="missing-value">Chưa có</span>';
    return `
      <span class="phone-value">${formatPhone(phone)}</span>
      <span class="row-phone-actions">
        <a class="action-btn action-btn--call" href="tel:${phone}" title="Gọi điện" aria-label="Gọi ${phone}"><img src="/icons/phone-call.svg" alt="" aria-hidden="true" /></a>
        <a class="action-btn action-btn--zalo" href="https://zalo.me/${phone}" target="_blank" rel="noreferrer" title="Mở Zalo" aria-label="Mở Zalo ${phone}"><img src="/icons/zalo.svg" alt="" aria-hidden="true" /></a>
      </span>
    `;
}

function renderRowActions(record, index, appointment) {
    const label = appointment ? 'Chia sẻ lịch hẹn' : 'Copy thông tin telesale';
    const type = appointment ? 'appointments' : 'leads';
    return `<button class="btn btn--icon row-action" type="button" data-action="view-detail" data-record-index="${index}" data-record-type="${type}" title="Xem chi tiết" aria-label="Xem chi tiết"><img src="/icons/file-text.svg" alt="" aria-hidden="true" /></button><button class="btn btn--icon row-action" type="button" data-action="copy-record" data-record-index="${index}" data-record-type="${type}" title="${label}" aria-label="${label}"><img src="/icons/copy.svg" alt="" aria-hidden="true" /></button>`;
}

function renderCopyAction(index, type, label) {
    return `<button class="btn btn--icon row-action" type="button" data-action="view-detail" data-record-index="${index}" data-record-type="${type}" title="Xem chi tiết" aria-label="Xem chi tiết"><img src="/icons/file-text.svg" alt="" aria-hidden="true" /></button><button class="btn btn--icon row-action" type="button" data-action="copy-record" data-record-index="${index}" data-record-type="${type}" title="${label}" aria-label="${label}"><img src="/icons/copy.svg" alt="" aria-hidden="true" /></button>`;
}

function renderTelegramAction(index, type) {
    return `<button class="btn btn--icon row-action" type="button" data-action="telegram-record" data-record-index="${index}" data-record-type="${type}" title="Gửi bản ghi này vào Telegram" aria-label="Gửi bản ghi này vào Telegram"><img src="/icons/send.svg" alt="" aria-hidden="true" /></button>`;
}

async function sendTelegramRecord(record, type, button) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        const response = await fetch('/api/telegram/send-record', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: buildTelesaleText(record, type), chatId: readTelegramGroup() })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Telegram chưa gửi được');
        window.showToast('Đã gửi thông tin vào Telegram', 'success');
    } catch (error) { window.showToast(error.message, 'error'); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}

function buildTelesaleText(record, type = 'leads') {
    const date = type === 'customers' ? record?.latestDate : record?.aptDate || record?.date;
    return [
        type === 'appointments' ? 'THÔNG TIN LỊCH HẸN BSN' : type === 'customers' ? 'THÔNG TIN KHÁCH HÀNG BSN' : 'THÔNG TIN LEAD BSN',
        `Khách hàng: ${record?.name || 'Chưa có tên'}`,
        `SĐT: ${normalizePhone(record?.phone) || 'Chưa có'}`,
        `Dịch vụ: ${record?.service || 'Chưa xác định'}`,
        `Nguồn: ${record?.source || 'Chưa xác định'}`,
        `Trạng thái: ${getDisplayStatus(record)}`,
        date ? `${type === 'appointments' ? 'Ngày hẹn' : type === 'customers' ? 'Lần tương tác gần nhất' : 'Ngày nhận'}: ${formatDateFull(toDate(date))}${type === 'appointments' && hasConfirmedTime(record) ? ` lúc ${record.time}` : ''}` : '',
        type === 'customers' && record?.revenue != null ? `Doanh thu: ${money(record.revenue)}` : '',
        `Nhân viên: ${record?.staff || 'Chưa xác định'}`,
        `Ghi chú: ${record?.note || 'Không có'}`
    ].filter(Boolean).join('\n');
}

async function copyText(text, message = 'Đã copy thông tin') {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        window.showToast(message, 'success');
        return true;
    } catch {
        window.showToast('Không thể copy tự động, hãy chọn và copy nội dung', 'error');
        return false;
    }
}

function openDetail(record, type) {
    const modal = document.getElementById('detailModal');
    if (!modal || !record) return;
    // A row detail replaces the KPI drill-down instead of stacking two dialogs.
    const drilldown = document.getElementById('drilldownModal');
    if (drilldown?.classList.contains('active')) {
        drilldown.classList.remove('active');
        drilldown.setAttribute('aria-hidden', 'true');
    }
    if (!drilldown?.contains(document.activeElement)) state.lastFocusedElement = document.activeElement;
    state.currentDetail = { record, type };
    setText('detailName', record.name || 'Chưa có tên');
    setText('detailPhone', normalizePhone(record.phone) ? formatPhone(record.phone) : 'Chưa có');
    setText('detailService', record.service || 'Chưa xác định');
    setText('detailSource', record.source || 'Chưa xác định');
    setText('detailDate', formatDateFull(toDate(type === 'customers' ? record.latestDate : record.aptDate || record.date)));
    const staffField = document.getElementById('detailStaff')?.closest('.detail-item');
    if (staffField) staffField.hidden = type === 'appointments';
    const dateLabel = document.getElementById('detailDate')?.previousElementSibling;
    if (dateLabel) dateLabel.textContent = type === 'appointments' ? 'Ngày hẹn' : type === 'customers' ? 'Lần tương tác gần nhất' : 'Ngày nhận';
    const timeline = document.getElementById('detailTimeline');
    if (timeline) {
        const events = type === 'customers' ? (record.records || []) : [{ ...record, source: record.source || type, date: record.aptDate || record.date }];
        timeline.innerHTML = events.length
            ? events.map(event => `
              <div class="timeline-item">
                <span class="timeline-item__dot"></span>
                <div>
                  <strong>${escapeHtml(event.source || type)}</strong>
                  <span>${formatDateFull(toDate(event.date || event.aptDate))}</span>
                  <p>${escapeHtml(event.note || event.status || 'Đã ghi nhận trong Sheet')}</p>
                </div>
              </div>
            `).join('')
            : '<p class="empty-inline">Chưa có lịch sử ghi nhận.</p>';
    }
    const copyButton = document.getElementById('detailCopyBtn');
    if (copyButton) copyButton.onclick = () => copyText(buildTelesaleText(record, type), 'Đã copy thông tin telesale');
    const sourceLink = document.getElementById('detailOpenSheet');
    if (sourceLink) sourceLink.href = type === 'marketing' ? MARKETING_SHEET_URL : CRM_SHEET_URL;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.modal__close')?.focus();
}

function closeModals() {
    document.querySelectorAll('.modal-overlay.active').forEach(modal => {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    });
    state.currentDetail = null;
    state.lastFocusedElement?.focus?.();
}

function bindKpiDrilldowns({ leads, booked, arrived }) {
    const mapping = [
        ['kpiTotalLead', 'Danh sách Lead', leads, 'leads'],
        ['kpiBooked', 'Danh sách lịch hẹn', booked, 'appointments'],
        ['kpiArrived', 'Danh sách khách đã đến', arrived, 'arrived'],
        ['kpiRevenue', 'Các lượt đến có doanh thu', arrived.filter(item => Number(item?.revenue) > 0), 'arrived']
    ];
    mapping.forEach(([id, title, records, type]) => {
        const card = document.getElementById(id);
        if (!card || card.dataset.drilldownBound) return;
        card.dataset.drilldownBound = 'true';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        const open = () => {
            const source = type === 'leads' ? 'leads' : type === 'appointments' ? 'booked' : 'arrived';
            let current = (state.data?.[source] || []).filter(record => type === 'appointments' && state.currentFilter === 'upcoming' ? isUpcomingAppointment(record) : inDateFilter(
                type === 'leads' ? record.date : type === 'appointments' ? record.aptDate : record.date || record.aptDate,
                state.currentFilter, state.customStart, state.customEnd));
            if (id === 'kpiRevenue') current = current.filter(record => Number(record.revenue) > 0);
            openDrilldown(title, current, type);
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });
    });
}

function openDrilldown(title, records, type) {
    const modal = document.getElementById('drilldownModal');
    const body = document.getElementById('drilldownBody');
    const head = document.getElementById('drilldownHead');
    if (!modal || !body || !head) return;
    state.lastFocusedElement = document.activeElement;
    setText('drilldownTitle', title);
    setText('drilldownSummary', `${records.length.toLocaleString('vi-VN')} bản ghi trong ${formatPeriodLabel()}`);
    head.innerHTML = '<tr><th>Khách hàng</th><th>SĐT</th><th>Dịch vụ</th><th>Ngày</th><th>Trạng thái</th></tr>';
    body.innerHTML = records.map((record, index) => `
      <tr data-drill-index="${index}" data-drill-type="${type}" tabindex="0">
        <td>${escapeHtml(record.name || 'Chưa có tên')}</td>
        <td>${escapeHtml(normalizePhone(record.phone) ? formatPhone(record.phone) : 'Chưa có')}</td>
        <td>${escapeHtml(record.service || 'Chưa xác định')}</td>
        <td>${formatDateFull(toDate(record.aptDate || record.date))}</td>
        <td>${escapeHtml(getDisplayStatus(record))}</td>
      </tr>
    `).join('');
    state.drilldownRecords = records;
    state.activeRecordType = type;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.modal__close')?.focus();
}

function renderMarketingDashboard() {
    const raw = Array.isArray(state.marketingData) ? state.marketingData : [];
    const data = raw
        .filter(item => inDateFilter(item?.date, state.currentFilter, state.customStart, state.customEnd))
        .filter(item => toDate(item?.date) && toDate(item.date) <= new Date())
        .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));

    const cost = sumMetric(data, 'cost');
    const ads = sumMetric(data, 'marketing_cost');
    const management = sumMetric(data, 'ad_management_fee');
    const revenue = sumMetric(data, 'revenue');
    const messages = sumMetric(data, 'messages');
    const totalData = sumMetrics(data, ['data_nangco', 'data_muichi', 'data_khac']);
    const totalBooked = sumMetrics(data, ['hen_nangco', 'hen_muichi', 'hen_khac']);
    const totalArrived = sumMetrics(data, ['toi_nangco', 'toi_muichi', 'toi_khac']);
    const roas = ads.hasValue && ads.value > 0 && revenue.hasValue ? revenue.value / ads.value : null;
    const costPerCustomer = totalArrived.hasValue && totalArrived.value > 0 && cost.hasValue ? cost.value / totalArrived.value : null;
    const metadata = raw.metadata || state.marketingMeta || {};

    setMetric('mktTổngChiPhí', cost);
    setMetric('mktTổngTinNhắn', messages, value => value.toLocaleString('vi-VN'));
    setMetric('mktTổngData', totalData, value => value.toLocaleString('vi-VN'));
    setMetric('mktTổngDoanhSố', revenue);
    setMetric('mktTỷLệChiPhí', { value: roas, hasValue: roas !== null }, value => `${value.toFixed(2)}x`);
    setMetric('mktTỷLệTới', { value: costPerCustomer, hasValue: costPerCustomer !== null });
    setMetric('mktGlobalReceived', officialMetric(raw, metadata, 'globalReceived'), value => money(value));
    setMetric('mktGlobalBalance', officialMetric(raw, metadata, 'globalBalance'), value => money(value));
    setText('mktCostBreakdown', `Ads: ${metricText(ads)} · Phí quản lý: ${metricText(management)}`);
    setText('mktCpmess', messages.hasValue && messages.value > 0 && cost.hasValue ? `Chi phí/tin: ${money(cost.value / messages.value)}` : 'Chi phí/tin: —');
    setText('mktCpData', totalData.hasValue && totalData.value > 0 && cost.hasValue ? `Chi phí/data: ${money(cost.value / totalData.value)}` : 'Chi phí/data: —');

    renderMarketingFunnelSafe('mktFunnelNangCo', data, ['data_nangco'], ['hen_nangco'], ['toi_nangco']);
    renderMarketingFunnelSafe('mktFunnelMuiChi', data, ['data_muichi'], ['hen_muichi'], ['toi_muichi']);
    renderMarketingFunnelSafe('mktFunnelKhac', data, ['data_khac'], ['hen_khac'], ['toi_khac']);
    if (cost.hasValue || revenue.hasValue) {
        renderMarketingPieCharts(cost.value || 0, revenue.value || 0, valueOf(data, 'toi_nangco'), valueOf(data, 'toi_muichi'), valueOf(data, 'toi_khac'));
    } else {
        clearMarketingChartContainers();
    }
    renderMarketingTrends(data);
    renderBudgetIntelligence(raw);
    renderMoMComparison(raw);
    renderPeriodAnalysis(raw);
    renderMarketingTable(data);
    const marketingStale = Boolean(state.refreshFailed || state.marketingMeta?.stale || state.marketingMeta?.status === 'stale');
    setDataStatus(marketingStale ? 'stale' : 'success', marketingStale
        ? 'Đang hiển thị dữ liệu Marketing gần nhất'
        : 'Dữ liệu Marketing đã cập nhật', state.marketingMeta || {});
}

function renderBudgetIntelligence(raw) {
    const referenceDate = new Date();
    const range = getDateRange(state.currentFilter, state.customStart, state.customEnd, referenceDate);
    const signature = `${state.currentFilter}:${state.customStart}:${state.customEnd}`;
    if (signature !== state.budgetFilterSignature) { state.budgetMonth = null; state.budgetFilterSignature = signature; }
    const monthKey = state.budgetMonth || dateKey(range.end && range.end < referenceDate ? range.end : referenceDate).slice(0, 7);
    const model = buildBudgetDecisionModel(raw, {
        referenceDate, cutoffDays: 2, adjustmentPercent: 10, monthKey,
        rangeStart: state.budgetMonth ? undefined : range.start,
        rangeEnd: state.budgetMonth ? undefined : range.end,
        stale: state.refreshFailed || state.marketingMeta?.stale || state.marketingMeta?.status === 'stale',
        crmRecords: state.budgetCrm?.arrived,
        crmAvailable: Boolean(state.budgetCrm), crmStale: state.budgetCrm?.metadata?.stale
    });
    const today = dateKey(referenceDate);
    model.upcomingAppointments = state.budgetCrm ? state.budgetCrm.booked.filter(r => {
        const key = dateKey(r.aptDate); return key && key >= today && !['arrived', 'cancelled'].includes(normalizeStatus(r.status));
    }).length : null;
    model.sourceFetchedAt = state.marketingMeta?.fetchedAt;
    state.lastBudgetModel = model;
    renderBudgetView(model, { onMonthChange: month => { state.budgetMonth = month; renderBudgetIntelligence(raw); } });
}
function officialMetric(raw, metadata, key) {
    const value = metadata?.[key] ?? raw?.[key];
    return value != null && value !== '' && Number.isFinite(Number(value)) ? { value: Number(value), hasValue: true } : { value: null, hasValue: false };
}

function sumMetric(records, field) {
    let total = 0;
    let hasValue = false;
    for (const record of records || []) {
        const value = Number(record?.[field]);
        if (record?.[field] !== null && record?.[field] !== undefined && record?.[field] !== '' && Number.isFinite(value)) {
            total += value;
            hasValue = true;
        }
    }
    return { value: hasValue ? total : null, hasValue };
}

function sumMetrics(records, fields) {
    let total = 0;
    let hasValue = false;
    for (const record of records || []) {
        for (const field of fields) {
            const value = Number(record?.[field]);
            if (record?.[field] !== null && record?.[field] !== undefined && record?.[field] !== '' && Number.isFinite(value)) {
                total += value;
                hasValue = true;
            }
        }
    }
    return { value: hasValue ? total : null, hasValue };
}

function valueOf(records, field) {
    return sumMetric(records, field).value || 0;
}

function setMetric(id, metric, formatter = money) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = metric?.hasValue ? formatter(metric.value) : '—';
}

function metricText(metric) {
    return metric?.hasValue ? money(metric.value) : '—';
}

function countMetricText(metric) {
    return metric?.hasValue ? Number(metric.value).toLocaleString('vi-VN') : '—';
}

function money(value) {
    return formatCurrency(Number(value));
}

function renderMarketingFunnelSafe(id, data, dataFields, bookedFields, arrivedFields) {
    const dataMetric = sumMetrics(data, dataFields);
    const bookedMetric = sumMetrics(data, bookedFields);
    const arrivedMetric = sumMetrics(data, arrivedFields);
    const container = document.getElementById(id);
    if (!container) return;
    if (!dataMetric.hasValue && !bookedMetric.hasValue && !arrivedMetric.hasValue) {
        container.innerHTML = '<div class="empty-inline">Chưa có dữ liệu cho nhóm này.</div>';
        return;
    }
    renderMarketingFunnelChart(id, dataMetric.value || 0, bookedMetric.value || 0, arrivedMetric.value || 0);
}

function clearMarketingChartContainers() {
    ['mktPieBudget', 'mktPieServices', 'mktFunnelNangCo', 'mktFunnelMuiChi', 'mktFunnelKhac'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = '<div class="empty-inline">Chưa có dữ liệu trong kỳ.</div>';
    });
}

function renderMarketingTable(data) {
    const body = document.getElementById('mktTableBody');
    if (!body) return;
    body.innerHTML = data.map(item => {
        const dailyData = sumMetrics([item], ['data_nangco', 'data_muichi', 'data_khac']);
        const dailyBooked = sumMetrics([item], ['hen_nangco', 'hen_muichi', 'hen_khac']);
        const dailyArrived = sumMetrics([item], ['toi_nangco', 'toi_muichi', 'toi_khac']);
        const dailyCost = numberMetric(item.cost);
        const dailyMessages = numberMetric(item.messages);
        return `
          <tr>
            <td data-label="Ngày">${formatDateFull(toDate(item.date))}</td>
            <td data-label="Tổng chi phí">${metricText(dailyCost)}<small class="table-subtext">Ads ${metricText(numberMetric(item.marketing_cost))} · QL ${metricText(numberMetric(item.ad_management_fee))}</small></td>
            <td data-label="Doanh thu">${metricText(numberMetric(item.revenue))}</td>
            <td data-label="Tin nhắn">${countMetricText(dailyMessages)}</td>
            <td data-label="Data">${countMetricText(dailyData)}</td>
            <td data-label="Hẹn">${countMetricText(dailyBooked)}</td>
            <td data-label="Tới">${countMetricText(dailyArrived)}</td>
            <td data-label="Chi phí/tin">${dailyMessages.hasValue && dailyMessages.value > 0 && dailyCost.hasValue ? money(dailyCost.value / dailyMessages.value) : '—'}</td>
            <td data-label="Chi phí/data">${dailyData.hasValue && dailyData.value > 0 && dailyCost.hasValue ? money(dailyCost.value / dailyData.value) : '—'}</td>
          </tr>
        `;
    }).join('');
}

function numberMetric(value) {
    const number = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(number)
        ? { value: number, hasValue: true }
        : { value: null, hasValue: false };
}

function renderMarketingTrends(data) {
    const canvas = document.getElementById('mktTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    window.mktTrendChartInstance?.destroy?.();
    if (!data.length) return;
    const chronological = [...data].reverse();
    window.mktTrendChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: chronological.map(item => formatDateShort(toDate(item.date))),
            datasets: [
                {
                    label: 'Chi phí (triệu)',
                    data: chronological.map(item => metricValue(item.cost, value => value / 1000000)),
                    borderColor: '#d97706',
                    backgroundColor: 'rgba(217,119,6,.12)',
                    yAxisID: 'money',
                    tension: .25,
                    spanGaps: false
                },
                {
                    label: 'Data',
                    data: chronological.map(item => sumOptional(item, ['data_nangco', 'data_muichi', 'data_khac'])),
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37,99,235,.08)',
                    yAxisID: 'count',
                    tension: .25,
                    spanGaps: false
                },
                {
                    label: 'Khách tới',
                    data: chronological.map(item => sumOptional(item, ['toi_nangco', 'toi_muichi', 'toi_khac'])),
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5,150,105,.08)',
                    yAxisID: 'count',
                    tension: .25,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom' } },
            scales: {
                money: { beginAtZero: true, position: 'left', title: { display: true, text: 'Triệu đồng' } },
                count: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Số lượng' } }
            }
        }
    });
}

function metricValue(value, transform = x => x) {
    const number = Number(value);
    return Number.isFinite(number) ? transform(number) : null;
}

function sumOptional(record, fields) {
    const values = fields.map(field => Number(record?.[field])).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function renderMoMComparison(raw) {
    const container = document.getElementById('momComparison');
    if (!container) return;
    const current = raw.filter(item => inDateFilter(item.date, 'month', '', ''));
    const previous = raw.filter(item => inDateFilter(item.date, 'lastmonth', '', ''));
    if (!current.length && !previous.length) {
        container.innerHTML = '<div class="empty-inline">Chưa có đủ dữ liệu để so sánh.</div>';
        return;
    }
    const metrics = [
        ['Chi phí', sumMetric(current, 'cost'), sumMetric(previous, 'cost')],
        ['Doanh thu', sumMetric(current, 'revenue'), sumMetric(previous, 'revenue')],
        ['Data', sumMetrics(current, ['data_nangco', 'data_muichi', 'data_khac']), sumMetrics(previous, ['data_nangco', 'data_muichi', 'data_khac'])],
        ['Khách tới', sumMetrics(current, ['toi_nangco', 'toi_muichi', 'toi_khac']), sumMetrics(previous, ['toi_nangco', 'toi_muichi', 'toi_khac'])]
    ];
    container.innerHTML = `<div class="comparison-grid">${metrics.map(([label, currentMetric, previousMetric]) => {
        const isCount = label === 'Data' || label === 'Khách tới';
        const format = isCount ? countMetricText : metricText;
        const currentText = format(currentMetric);
        const previousText = format(previousMetric);
        const delta = currentMetric.hasValue && previousMetric.hasValue && previousMetric.value !== 0
            ? `${((currentMetric.value - previousMetric.value) / Math.abs(previousMetric.value) * 100).toFixed(1)}%`
            : '—';
        return `<div class="comparison-item"><span>${label}</span><strong>${currentText}</strong><small>Kỳ trước: ${previousText} · ${delta}</small></div>`;
    }).join('')}</div>`;
}

function renderPeriodAnalysis(raw) {
    const container = document.getElementById('mktPeriodAnalysis');
    if (!container) return;
    const heading = document.getElementById('periodAnalysisTitle');
    if (heading) heading.textContent = `Phân tích theo giai đoạn · ${formatPeriodLabel()}`;
    const current = raw.filter(item => inDateFilter(item.date, state.currentFilter, state.customStart, state.customEnd));
    if (!current.length) {
        container.innerHTML = `<div class="empty-inline">Chưa có dữ liệu trong ${escapeHtml(formatPeriodLabel().toLowerCase())}.</div>`;
        return;
    }
    const ranges = [
        ['Đầu tháng', item => toDate(item.date)?.getDate() <= 10],
        ['Giữa tháng', item => toDate(item.date)?.getDate() >= 11 && toDate(item.date)?.getDate() <= 20],
        ['Cuối tháng', item => toDate(item.date)?.getDate() >= 21]
    ];
    container.innerHTML = `<div class="comparison-grid">${ranges.map(([label, predicate]) => {
        const records = current.filter(predicate);
        const cost = sumMetric(records, 'cost');
        const data = sumMetrics(records, ['data_nangco', 'data_muichi', 'data_khac']);
        return `<div class="comparison-item"><span>${label}</span><strong>${metricText(cost)}</strong><small>Data: ${countMetricText(data)} · ${records.length} ngày có dòng</small></div>`;
    }).join('')}</div>`;
}

function setupEvents() {
    els.refreshBtn?.addEventListener('click', () => {
        if (!state.loading) loadData();
    });

    els.autoRefreshToggle?.addEventListener('change', event => {
        if (event.target.checked) startAutoRefresh();
        else stopAutoRefresh();
    });
    document.getElementById('filterTabs')?.addEventListener('click', event => {
        const tab = event.target.closest('.filter-tab');
        if (!tab) return;
        state.currentFilter = tab.dataset.filter || 'month';
        saveFilterState();
        syncFilterTabs();
        if (els.dashboard) renderDashboard();
        if (els.marketing) renderMarketingDashboard();
    });
    els.applyCustomDateBtn?.addEventListener('click', () => {
        const start = els.dateStart?.value || '';
        const end = els.dateEnd?.value || '';
        if (!start && !end) {
            window.showToast('Chọn ít nhất một ngày để lọc', 'error');
            return;
        }
        if (start && end && start > end) {
            window.showToast('Ngày bắt đầu phải trước ngày kết thúc', 'error');
            return;
        }
        state.customStart = start;
        state.customEnd = end;
        state.currentFilter = 'custom';
        saveFilterState();
        syncFilterTabs();
        if (els.dashboard) renderDashboard();
        if (els.marketing) renderMarketingDashboard();
    });
    els.tableSearch?.addEventListener('input', event => {
        state.tableSearch = event.target.value;
        renderRecordTable();
    });
    els.globalSearch?.addEventListener('input', event => {
        state.tableSearch = event.target.value;
        if (els.tableSearch) els.tableSearch.value = state.tableSearch;
        renderRecordTable();
    });
    els.serviceFilter?.addEventListener('change', event => {
        state.serviceFilter = event.target.value;
        saveFilterState();
        renderRecordTable();
    });
    els.statusFilter?.addEventListener('change', event => {
        state.statusFilter = event.target.value;
        saveFilterState();
        renderRecordTable();
    });
    document.getElementById('recordTabs')?.addEventListener('click', event => {
        const tab = event.target.closest('[data-record-view]');
        if (!tab) return;
        state.recordView = tab.dataset.recordView;
        saveFilterState();
        document.querySelectorAll('#recordTabs [data-record-view]').forEach(item => {
            const active = item === tab;
            item.classList.toggle('record-tab--active', active);
            item.setAttribute('aria-selected', String(active));
        });
        renderRecordTable();
    });
    document.getElementById('marketingDataTabs')?.addEventListener('click', event => {
        const tab = event.target.closest('[data-marketing-tab]');
        if (!tab) return;
        document.querySelectorAll('#marketingDataTabs [data-marketing-tab]').forEach(item => {
            const active = item === tab;
            item.classList.toggle('record-tab--active', active);
            item.setAttribute('aria-selected', String(active));
        });
        const targets = { overview: 'mktKpiRow', daily: 'marketingDailySection', budget: 'budgetIntelligence' };
        document.getElementById(targets[tab.dataset.marketingTab])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.addEventListener('click', event => {
        const closeButton = event.target.closest('.modal__close');
        if (closeButton) closeModals();
        if (event.target.classList.contains('modal-overlay')) closeModals();
        const telegramButton = event.target.closest('[data-action="telegram-record"]');
        if (telegramButton) {
            event.stopPropagation();
            const record = state.tableRecords[Number(telegramButton.dataset.recordIndex)];
            if (record) sendTelegramRecord(record, telegramButton.dataset.recordType, telegramButton);
            return;
        }
        const detailButton = event.target.closest('[data-action="view-detail"]');
        if (detailButton) {
            event.stopPropagation();
            const record = state.tableRecords[Number(detailButton.dataset.recordIndex)];
            if (record) openDetail(record, detailButton.dataset.recordType || state.activeRecordType);
            return;
        }
        const copyButton = event.target.closest('[data-action="copy-record"]');
        if (copyButton) {
            event.stopPropagation();
            const index = Number(copyButton.dataset.recordIndex);
            const type = copyButton.dataset.recordType || 'leads';
            const record = state.tableRecords[index];
            if (record) copyText(buildTelesaleText(record, type), 'Đã copy thông tin telesale');
        }
        const overdueButton = event.target.closest('[data-overdue-index]');
        if (overdueButton) {
            const record = (window.__overdueData || [])[Number(overdueButton.dataset.overdueIndex)];
            if (record) copyText(buildTelesaleText(record, 'appointments'), 'Đã copy thông tin lịch hẹn');
        }
        const row = event.target.closest('tr[data-record-index]');
        if (row && !event.target.closest('a,button')) {
            const record = state.tableRecords[Number(row.dataset.recordIndex)];
            if (record) openDetail(record, row.dataset.recordType || state.activeRecordType);
        }
        const drillRow = event.target.closest('tr[data-drill-index]');
        if (drillRow) {
            const record = state.drilldownRecords[Number(drillRow.dataset.drillIndex)];
            if (record) openDetail(record, drillRow.dataset.drillType || state.activeRecordType);
        }
    });
    document.addEventListener('keydown', event => {
        const modal = document.querySelector('.modal-overlay.active');
        if (modal && event.key === 'Tab') {
            const controls = [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
                .filter(el => !el.disabled && el.getClientRects().length);
            const first = controls[0], last = controls.at(-1);
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
                event.preventDefault(); first.focus();
            }
        }
        if (event.key === 'Escape' && modal) closeModals();
        if (event.key === 'Enter' && event.target.matches('tr[data-drill-index]')) {
            const record = state.drilldownRecords[Number(event.target.dataset.drillIndex)];
            if (record) openDetail(record, event.target.dataset.drillType);
        }
        if (event.key === 'Enter' && event.target.matches('tr[data-record-index]')) {
            const record = state.tableRecords[Number(event.target.dataset.recordIndex)];
            if (record) openDetail(record, event.target.dataset.recordType || state.activeRecordType);
        }
    });
}

function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshInterval = window.setInterval(loadData, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (state.autoRefreshInterval) {
        window.clearInterval(state.autoRefreshInterval);
        state.autoRefreshInterval = null;
    }
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? '—';
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
    initDom();
    setupEvents();
    prepareMobileLayout();
    syncFilterTabs();
    document.body.classList.add('light-theme');
    connectSheet();
    initAppShell({ refresh: loadData, lastSuccess: () => state.lastRefresh?.getTime() || 0, isBusy: () => state.loading || Boolean(state.telegramPending) });
}

function prepareMobileLayout() {
    if (!window.matchMedia?.('(max-width: 767px)').matches) return;
    const dashboard = document.getElementById('dashboard');
    const content = dashboard?.querySelector('.main-content');
    if (!dashboard || !content || content.dataset.mobilePrepared) return;
    content.dataset.mobilePrepared = 'true';
    [...content.children].forEach(child => dashboard.appendChild(child));
    content.remove();
}

document.addEventListener('DOMContentLoaded', init);
import { buildBudgetDecisionModel } from './core/analytics/budget-intelligence.js';


