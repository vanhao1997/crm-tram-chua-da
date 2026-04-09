/**
 * BSN CRM Dashboard — Main Entry Point
 * Orchestrates data fetching, rendering, and auto-refresh
 */

import { parseSheetUrl, fetchAllData } from './sheets-api.js';
import { renderAppointmentTable, getOverdueAppointments, renderOverdueList, setupFilterTabs } from './appointments.js';
import { renderKPICards, renderFunnelChart, renderRevenueChart, renderStatusChart } from './charts.js';

// ─── State ───
let state = {
    sheetId: null,
    data: null,
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
    els.loadingOverlay = document.getElementById('loadingOverlay');
    els.welcomeScreen = document.getElementById('welcomeScreen');
    els.dashboard = document.getElementById('dashboard');
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
        state.data = await fetchAllData(state.sheetId);

        // Switch to dashboard view
        els.welcomeScreen.style.display = 'none';
        els.dashboard.style.display = 'flex';

        renderDashboard();

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

// ─── Render Dashboard ───
function renderDashboard() {
    if (!state.data) return;

    const { leads, booked, arrived } = state.data;

    // KPI Cards
    renderKPICards(leads, booked, arrived);

    // Appointment Table
    renderAppointmentTable(booked, state.currentFilter);
    setupFilterTabs(booked);

    // Overdue List
    const overdue = getOverdueAppointments(booked, arrived);
    renderOverdueList(overdue);

    // Charts
    renderFunnelChart(leads, booked, arrived);
    renderRevenueChart(arrived);
    renderStatusChart(leads);
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
    els.connectBtn.addEventListener('click', connectSheet);

    // Enter key in URL input
    els.sheetUrl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') connectSheet();
    });

    // Manual refresh
    els.refreshBtn.addEventListener('click', () => {
        if (state.sheetId) loadData();
        else showToast('Chưa kết nối Google Sheet', 'error');
    });

    // Auto refresh toggle
    els.autoRefreshToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            startAutoRefresh();
            showToast('Auto-refresh: BẬT (mỗi 1 tiếng)', 'info');
        } else {
            stopAutoRefresh();
            showToast('Auto-refresh: TẮT', 'info');
        }
    });

    // Filter tab handler (delegated via setupFilterTabs in appointments.js)
    document.getElementById('filterTabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (tab) {
            state.currentFilter = tab.dataset.filter;
        }
    });
}

// ─── Initialize ───
function init() {
    initDom();
    setupEvents();

    // Restore saved URL
    const savedUrl = localStorage.getItem('bsn_sheet_url');
    if (savedUrl) {
        els.sheetUrl.value = savedUrl;
        // Auto-connect on load
        connectSheet();
    }

    // Start auto-refresh if toggle is checked
    if (els.autoRefreshToggle.checked) {
        startAutoRefresh();
    }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
