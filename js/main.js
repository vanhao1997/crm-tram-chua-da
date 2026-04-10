/**
 * BSN CRM Dashboard — Main Entry Point
 * Orchestrates data fetching, rendering, and auto-refresh
 */

import { parseSheetUrl, fetchAllData } from './sheets-api.js';
import { renderAppointmentTable, getOverdueAppointments, renderOverdueList } from './appointments.js';
import { renderKPICards, renderFunnelChart, renderRevenueChart, renderStatusChart } from './charts.js';
import { initLeadManager } from './lead-manager.js';

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
    els.themeToggleBtn = document.getElementById('themeToggleBtn');
    els.loadingOverlay = document.getElementById('loadingOverlay');
    els.welcomeScreen = document.getElementById('welcomeScreen');
    els.dashboard = document.getElementById('dashboard');
    els.toastContainer = document.getElementById('toastContainer');

    // AI Elements
    els.openaiKey = document.getElementById('openaiKey');
    els.aiAnalyzeBtn = document.getElementById('aiAnalyzeBtn');
    els.aiReportBox = document.getElementById('aiReportBox');
    els.aiReportContent = document.getElementById('aiReportContent');
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

    // Filter tab handler (Global)
    document.getElementById('filterTabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (tab) {
            // Update UI tabs
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('filter-tab--active'));
            tab.classList.add('filter-tab--active');

            // Update state and re-render everything
            state.currentFilter = tab.dataset.filter;
            renderDashboard();
        }
    });

    // Theme Toggle
    els.themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        els.themeToggleBtn.textContent = isLight ? '🌙' : '☀️';
        localStorage.setItem('bsn_theme', isLight ? 'light' : 'dark');
    });

    // AI Analytics Buttons
    els.aiAnalyzeBtn.addEventListener('click', runAIAnalysis);
}

// ─── AI Analytics ───
async function runAIAnalysis() {
    const apiKey = els.openaiKey.value.trim();
    if (!apiKey) {
        showToast('Vui lòng nhập OpenAI API Key', 'error');
        return;
    }

    // Save key locally
    localStorage.setItem('bsn_openai_key', apiKey);

    if (!state.data) {
        showToast('Chưa kết nối dữ liệu Google Sheet', 'error');
        return;
    }

    els.aiReportBox.style.display = 'block';
    els.aiReportContent.innerHTML = '🤖 Đang đọc dữ liệu và phân tích... Vui lòng đợi (khoảng 5-10s)...';
    els.aiAnalyzeBtn.disabled = true;

    try {
        // Lọc các ca rớt (từ toàn bộ leads, không bị gò bó bởi filter ngày)
        const failedLeads = state.data.leads.filter(l => {
            const status = String(l.status).toLowerCase();
            return status.includes('hủy') || status.includes('ko nghe') || status.includes('nghe máy') || status.includes('không hoàn') || status.includes('thuê bao');
        });

        // Chỉ lấy những khách có ghi chú
        const hints = failedLeads
            .filter(l => l.note && l.note.trim().length > 3)
            .map(l => `- DV: ${l.service || 'Không rõ'} | Note: "${l.note}"`)
            .join('\n');

        if (!hints) {
            els.aiReportContent.innerHTML = 'Không có đủ dữ liệu ghi chú hợp lệ để phân tích rớt khách.';
            els.aiAnalyzeBtn.disabled = false;
            return;
        }

        const prompt = `Bạn là một chuyên gia quản lý chất lượng (QA) phân tích CRM cho một thẩm mỹ viện (Trạm Chữa Da BSN).
Dưới đây là ghi chú telesale của các khách hàng ĐÃ HỦY LỊCH, KHÔNG NGHE MÁY, hoặc chốt FAIL.
Hãy đọc các dòng note và:
1. Phân loại 3-4 nhóm nguyên nhân phổ biến nhất khiến khách không đến hoặc chốt fail.
2. Cho lời khuyên ngắn gọn cho team marketing / telesale để cải thiện.
Trình bày tóm tắt, rõ ràng, gạch đầu dòng. Đừng để câu quá dài.

Dữ liệu:
${hints}`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 800
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Lỗi từ API OpenAI');
        }

        const data = await response.json();
        const markdown = data.choices[0].message.content;

        // Simple Markdown parser to HTML
        let html = markdown
            .replace(/(?:\r\n|\r|\n)/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/### (.*?)(<br>|$)/g, '<strong style="font-size:1.1em; color:var(--text-primary)">$1</strong><br>');

        els.aiReportContent.innerHTML = html;
        showToast('Phân tích AI thành công!', 'success');
    } catch (err) {
        console.error(err);
        els.aiReportContent.innerHTML = `<strong style="color:var(--accent-red)">Lỗi:</strong> ${err.message}`;
    } finally {
        els.aiAnalyzeBtn.disabled = false;
    }
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

    // Restore saved URL
    const savedUrl = localStorage.getItem('bsn_sheet_url');
    if (savedUrl) {
        els.sheetUrl.value = savedUrl;
        // Auto-connect on load
        connectSheet();
    }

    // Restore Theme
    const savedTheme = localStorage.getItem('bsn_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        els.themeToggleBtn.textContent = '🌙';
    }

    // Restore OpenAI API Key
    const savedKey = localStorage.getItem('bsn_openai_key');
    if (savedKey) {
        els.openaiKey.value = savedKey;
    }

    // Start auto-refresh if toggle is checked
    if (els.autoRefreshToggle.checked) {
        startAutoRefresh();
    }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
