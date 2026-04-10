/**
 * BSN CRM Dashboard — Main Entry Point
 * Orchestrates data fetching, rendering, and auto-refresh
 */

import { parseSheetUrl, fetchAllData } from './sheets-api.js';
import { renderAppointmentTable, getOverdueAppointments, renderOverdueList } from './appointments.js';
import { renderKPICards, renderFunnelChart, renderRevenueChart, renderStatusChart } from './charts.js';
import { initLeadManager } from './lead-manager.js';
import { fetchMarketingData, formatCurrency, formatDateFull } from './sheets-api.js';
import { renderMarketingFunnelChart } from './charts.js';

// ─── State ───
let state = {
    sheetId: null,
    data: null,
    marketingData: null,
    currentFilter: 'today',
    autoRefreshInterval: null,
    autoRefreshMs: 60 * 60 * 1000 // 1 hour
};

// ─── DOM Elements ───
const els = {};

function initDom() {
    els.sheetUrl = document.getElementById('sheetUrl');
    els.connectBtn = document.getElementById('connectBtn');
    els.refreshBtn = document.getElementById('refreshBtn');
    els.lastRefresh = document.getElementById('lastRefresh');
    els.autoRefreshToggle = document.getElementById('autoRefreshToggle');
    els.themeToggleBtn = document.getElementById('themeToggleBtn');
    els.loadingOverlay = document.getElementById('loadingOverlay');
    els.welcomeScreen = document.getElementById('welcomeScreen');
    els.dashboard = document.getElementById('dashboard');
    els.marketing = document.getElementById('marketing');
    els.toastContainer = document.getElementById('toastContainer');
}

// ─── Toast Notifications ───
window.showToast = function (message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// ─── Loading State ───
function showLoading() {
    els.loadingOverlay.classList.add('active');
    els.refreshBtn.classList.add('refreshing');
}

function hideLoading() {
    els.loadingOverlay.classList.remove('active');
    els.refreshBtn.classList.remove('refreshing');
}

// ─── Connect to Sheet ───
async function connectSheet() {
    const url = els.sheetUrl.value.trim();
    if (!url) {
        showToast('Vui lòng paste link Google Sheet', 'error');
        return;
    }

    try {
        state.sheetId = parseSheetUrl(url);

        // Save to localStorage
        localStorage.setItem('bsn_sheet_url', url);

        await loadData();

        showToast('Kết nối thành công! 🎉', 'success');
    } catch (err) {
        showToast(err.message, 'error');
        console.error('Connect error:', err);
    }
}

// ─── Load Data ───
async function loadData() {
    if (!state.sheetId) return;

    showLoading();

    try {
        // Switch to appropriate view depending on the page
        els.welcomeScreen.style.display = 'none';
        if (els.dashboard) els.dashboard.style.display = 'flex';
        if (els.marketing) els.marketing.style.display = 'flex';

        // Load CRM Dashboard Data
        if (els.dashboard) {
            state.data = await fetchAllData(state.sheetId);
            renderDashboard();
        }

        // Load Marketing Data if on marketing page
        if (els.marketing) {
            try {
                // Ensure marketing data fetch resolves independently for the marketing page
                state.marketingData = await fetchMarketingData(state.sheetId);
                renderMarketingDashboard();
            } catch (mktErr) {
                console.error('Marketing Load error:', mktErr);
                showToast('Không tải được dữ liệu Marketing', 'error');
            }
        }

        // Update last refresh time
        const now = new Date();
        els.lastRefresh.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    } catch (err) {
        showToast(`Lỗi tải dữ liệu: ${err.message}`, 'error');
        console.error('Load error:', err);
    } finally {
        hideLoading();
    }
}

// ─── Filter Helpers ───
function isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getDate() === d2.getDate() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getFullYear() === d2.getFullYear();
}

function isThisWeek(d) {
    if (!d) return false;
    const today = new Date();
    const startOfWeek = new Date(today);
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1;
    startOfWeek.setDate(today.getDate() - diff);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    return d >= startOfWeek && d <= endOfWeek;
}

function isThisMonth(d) {
    if (!d) return false;
    const today = new Date();
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

function isLastMonth(d) {
    if (!d) return false;
    const today = new Date();
    let lastMonth = today.getMonth() - 1;
    let year = today.getFullYear();
    if (lastMonth < 0) { lastMonth = 11; year--; }
    return d.getMonth() === lastMonth && d.getFullYear() === year;
}

function filterDataByDate(dataArray, dateField, filterType) {
    return dataArray.filter(item => {
        const d = item[dateField];
        if (!d) return false;
        switch (filterType) {
            case 'today': return isSameDay(d, new Date());
            case 'week': return isThisWeek(d);
            case 'month': return isThisMonth(d);
            case 'lastmonth': return isLastMonth(d);
            case 'all': return true;
            default: return true;
        }
    });
}

// ─── Render Dashboard ───
function renderDashboard() {
    if (!state.data) return;

    // Apply global filters
    const filter = state.currentFilter;
    const leads = filterDataByDate(state.data.leads, 'date', filter);
    const booked = filterDataByDate(state.data.booked, 'aptDate', filter);
    // For arrived, user measures revenue based on aptDate (Ngày hẹn) instead of creation date
    const arrived = filterDataByDate(state.data.arrived, 'aptDate', filter);

    // KPI Cards
    renderKPICards(leads, booked, arrived);

    // Appointment Table
    renderAppointmentTable(booked, 'all'); // data is already filtered globally

    // Overdue List
    // We pass the global data for overdue, not the filtered one, to avoid missing old overdue!
    const overdue = getOverdueAppointments(state.data.booked, state.data.arrived);
    renderOverdueList(overdue);

    // Charts
    renderFunnelChart(leads, booked, arrived);
    renderRevenueChart(arrived);
    renderStatusChart(leads);
}

// ─── Render Marketing Dashboard ───
function renderMarketingDashboard() {
    if (!state.marketingData) return;

    // Apply global filter
    const filter = state.currentFilter;
    const data = filterDataByDate(state.marketingData, 'date', filter);

    let totalCost = 0;
    let totalRev = 0;
    let dataNangCo = 0, henNangCo = 0, toiNangCo = 0;
    let dataMuiChi = 0, henMuiChi = 0, toiMuiChi = 0;

    let tableHtml = '';

    for (const item of data) {
        totalCost += item.cost;
        totalRev += item.revenue;

        dataNangCo += item.data_nangco;
        henNangCo += item.hen_nangco;
        toiNangCo += item.toi_nangco;

        dataMuiChi += item.data_muichi;
        henMuiChi += item.hen_muichi;
        toiMuiChi += item.toi_muichi;

        // Buid table row
        const costStr = formatCurrency(item.cost);
        const revStr = formatCurrency(item.revenue);
        const costPerCus = item.toi_nangco + item.toi_muichi + item.toi_khac > 0
            ? formatCurrency(item.cost / (item.toi_nangco + item.toi_muichi + item.toi_khac))
            : '0';

        tableHtml += `
            <tr>
                <td class="td-name">${formatDateFull(item.date)}</td>
                <td style="color:var(--accent-red); font-weight:600">${costStr}</td>
                <td style="color:var(--accent-emerald); font-weight:600">${revStr}</td>
                <td>${item.data_nangco}</td>
                <td>${item.data_muichi}</td>
                <td>${item.hen_nangco}</td>
                <td>${item.hen_muichi}</td>
                <td>${item.toi_nangco}</td>
                <td>${item.toi_muichi}</td>
                <td style="color:var(--accent-blue)">${costPerCus}</td>
            </tr>
        `;
    }

    // ROAS logic
    const roas = totalRev > 0 ? ((totalCost / totalRev) * 100).toFixed(2) : 0;

    // Total arrived
    const totalArrivedAll = toiNangCo + toiMuiChi + data.reduce((sum, i) => sum + i.toi_khac, 0);
    const avgCostPerCus = totalArrivedAll > 0 ? (totalCost / totalArrivedAll) : 0;

    // Update KPI UI
    document.getElementById('mktTổngChiPhí').textContent = formatCurrency(totalCost);
    document.getElementById('mktTổngDoanhSố').textContent = formatCurrency(totalRev);
    document.getElementById('mktTỷLệChiPhí').textContent = roas + '%';
    document.getElementById('mktTỷLệTới').textContent = formatCurrency(avgCostPerCus);

    // Update charts
    renderMarketingFunnelChart('mktFunnelNangCo', dataNangCo, henNangCo, toiNangCo);
    renderMarketingFunnelChart('mktFunnelMuiChi', dataMuiChi, henMuiChi, toiMuiChi);

    // Table
    document.getElementById('mktTableBody').innerHTML = tableHtml;
}

// ─── Auto Refresh ───
function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshInterval = setInterval(() => {
        loadData();
    }, state.autoRefreshMs);
}

function stopAutoRefresh() {
    if (state.autoRefreshInterval) {
        clearInterval(state.autoRefreshInterval);
        state.autoRefreshInterval = null;
    }
}

// ─── Event Listeners ───
function setupEvents() {
    // Connect button
    els.connectBtn?.addEventListener('click', connectSheet);

    // Enter key in URL input
    els.sheetUrl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') connectSheet();
    });

    // Manual refresh
    els.refreshBtn?.addEventListener('click', () => {
        if (state.sheetId) loadData();
        else showToast('Chưa kết nối Google Sheet', 'error');
    });

    // Auto refresh toggle
    els.autoRefreshToggle?.addEventListener('change', (e) => {
        if (e.target.checked) {
            startAutoRefresh();
            showToast('Auto-refresh: BẬT (mỗi 1 tiếng)', 'info');
        } else {
            stopAutoRefresh();
            showToast('Auto-refresh: TẮT', 'info');
        }
    });

    // Filter tab handler (Global)
    document.getElementById('filterTabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (tab) {
            // Update UI tabs
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('filter-tab--active'));
            tab.classList.add('filter-tab--active');

            // Update state and re-render everything
            state.currentFilter = tab.dataset.filter;
            if (els.dashboard) renderDashboard();
            if (els.marketing) renderMarketingDashboard();
        }
    });

    // Theme Toggle
    els.themeToggleBtn?.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        if (els.themeToggleBtn) els.themeToggleBtn.textContent = isLight ? '🌙' : '☀️';
        localStorage.setItem('bsn_theme', isLight ? 'light' : 'dark');
    });
}


// ─── Initialize ───
function init() {
    initDom();
    setupEvents();

    // Init Lead Manager (Phase 4)
    initLeadManager({
        getData: () => state.data,
        onRefresh: () => { if (state.sheetId) loadData(); }
    });

    // Restore Theme
    const savedTheme = localStorage.getItem('bsn_theme');
    if (savedTheme !== 'dark') { // Default to light if nothing saved
        document.body.classList.add('light-theme');
        if (els.themeToggleBtn) els.themeToggleBtn.textContent = '🌙';
    }


    // Set Hardcoded URLs based on active page and Auto Connect
    if (els.dashboard && els.sheetUrl) {
        els.sheetUrl.value = 'https://docs.google.com/spreadsheets/d/19Q1Fy1bvnElYhGCCLdDzC4TRzIJQn73lk7LpEN7fX2Q/edit?usp=sharing';
    } else if (els.marketing && els.sheetUrl) {
        els.sheetUrl.value = 'https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/edit?gid=1227076939#gid=1227076939';
    }

    // Hide the input fields to prevent modification since it is hardcoded
    if (els.sheetUrl?.parentElement) {
        els.sheetUrl.parentElement.style.display = 'none';
    }

    // Connect immediately
    connectSheet();

    // Start auto-refresh if toggle is checked
    if (els.autoRefreshToggle.checked) {
        startAutoRefresh();
    }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
