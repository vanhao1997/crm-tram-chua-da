/**
 * BSN CRM Dashboard — Main Entry Point
 * Orchestrates data fetching, rendering, and auto-refresh
 */

import { parseSheetUrl, fetchAllData } from './sheets-api.js';
import { renderAppointmentTable, getOverdueAppointments, renderOverdueList } from './appointments.js';
import { renderKPICards, renderFunnelChart, renderRevenueChart, renderStatusChart } from './charts.js';
import { initLeadManager } from './lead-manager.js';
import { fetchMarketingData, formatCurrency, formatDateFull } from './sheets-api.js';
import { renderMarketingFunnelChart, renderMarketingPieCharts } from './charts.js';

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
    els.refreshBtn = document.getElementById('refreshBtn');
    els.lastRefresh = document.getElementById('lastRefresh');
    els.autoRefreshToggle = document.getElementById('autoRefreshToggle');
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
    let url = '';
    if (els.dashboard) {
        url = 'https://docs.google.com/spreadsheets/d/19Q1Fy1bvnElYhGCCLdDzC4TRzIJQn73lk7LpEN7fX2Q/edit?usp=sharing';
    } else if (els.marketing) {
        url = 'https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/edit?gid=1227076939#gid=1227076939';
    }

    if (!url) return;

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
        // Setup filter defaults based on page
        const initialActive = document.querySelector('.filter-tabs .filter-tab--active');
        if (initialActive) {
            state.currentFilter = initialActive.dataset.filter || 'today';
        }

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

function isUpcoming(d) {
    if (!d) return false;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return d > today;
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
            case 'upcoming': return isUpcoming(d);
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
    let data = filterDataByDate(state.marketingData, 'date', filter);

    // Remove future dates and sort from newest to oldest
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    data = data.filter(item => item.date && item.date <= today)
        .sort((a, b) => b.date.getTime() - a.date.getTime());

    let totalCost = 0;
    let totalMktCost = 0;
    let totalAdFee = 0;
    let totalRev = 0;
    let totalMessages = 0;
    let totalReceived = 0;
    let dataNangCo = 0, henNangCo = 0, toiNangCo = 0;
    let dataMuiChi = 0, henMuiChi = 0, toiMuiChi = 0;
    let dataKhac = 0, toiKhac = 0;

    let tableHtml = '';

    for (const item of data) {
        totalCost += item.cost;
        totalMktCost += item.marketing_cost || 0;
        totalAdFee += item.ad_management_fee || 0;
        totalRev += item.revenue;
        totalMessages += item.messages || 0;
        totalReceived += item.received || 0;

        dataNangCo += item.data_nangco;
        henNangCo += item.hen_nangco;
        toiNangCo += item.toi_nangco;

        dataMuiChi += item.data_muichi;
        henMuiChi += item.hen_muichi;
        toiMuiChi += item.toi_muichi;

        dataKhac += item.data_khac || 0;
        toiKhac += item.toi_khac || 0;

        // Buid table row
        const costStr = formatCurrency(item.cost);
        const revStr = formatCurrency(item.revenue);
        const costPerMessStr = item.messages && item.messages > 0 ? formatCurrency(item.cost / item.messages) : '0';
        const costBreakdownStr = `Mkt: ${formatCurrency(item.marketing_cost || 0)}<br>QL: ${formatCurrency(item.ad_management_fee || 0)}`;

        const totalDataRow = (item.data_nangco || 0) + (item.data_muichi || 0) + (item.data_khac || 0);
        const totalHenRow = (item.hen_nangco || 0) + (item.hen_muichi || 0) + (item.hen_khac || 0);
        const totalToiRow = (item.toi_nangco || 0) + (item.toi_muichi || 0) + (item.toi_khac || 0);

        const costPerDataStr = totalDataRow > 0 ? formatCurrency(item.cost / totalDataRow) : '0';

        tableHtml += `
            <tr>
                <td class="td-name" data-label="Ngày">${formatDateFull(item.date)}</td>
                <td style="color:var(--accent-red); font-weight:600" data-label="Chi phí">
                    <div>${costStr}</div>
                    <div style="font-size:11px; font-weight:normal; line-height:1.2; margin-top:2px;">${costBreakdownStr}</div>
                </td>
                <td style="color:var(--accent-emerald); font-weight:600" data-label="Doanh thu">${revStr}</td>
                <td style="font-weight:600; color:var(--accent-amber);" data-label="Tin nhắn">${item.messages || 0}</td>
                <td data-label="DATA">${totalDataRow}</td>
                <td data-label="HẸN">${totalHenRow}</td>
                <td data-label="TỚI">${totalToiRow}</td>
                <td style="color:var(--accent-blue)" data-label="Giá 1 Tin">${costPerMessStr}</td>
                <td style="color:var(--accent-purple)" data-label="Giá 1 Data">${costPerDataStr}</td>
            </tr>
        `;
    }

    // ROAS logic
    const roas = totalRev > 0 ? ((totalCost / totalRev) * 100).toFixed(2) : 0;

    // Total arrived
    const totalArrivedAll = toiNangCo + toiMuiChi + data.reduce((sum, i) => sum + i.toi_khac, 0);
    const avgCostPerCus = totalArrivedAll > 0 ? (totalCost / totalArrivedAll) : 0;

    // Update KPI UI
    animateValue(document.getElementById('mktTổngChiPhí'), 0, totalCost, 800, formatCurrency);

    const mktGlobalReceivedEl = document.getElementById('mktGlobalReceived');
    if (mktGlobalReceivedEl) {
        animateValue(mktGlobalReceivedEl, 0, totalReceived, 800, formatCurrency);
    }
    const mktGlobalBalanceEl = document.getElementById('mktGlobalBalance');
    if (mktGlobalBalanceEl) {
        const dynamicBalance = totalReceived - totalCost;
        animateValue(mktGlobalBalanceEl, 0, dynamicBalance, 800, formatCurrency);
    }

    const mktKpiReceivedCard = document.getElementById('mktKpiReceived');
    const mktKpiBalanceCard = document.getElementById('mktKpiBalance');
    if (mktKpiReceivedCard && mktKpiBalanceCard) {
        if (filter === 'month' || filter === 'lastmonth' || filter === 'all') {
            mktKpiReceivedCard.style.display = 'flex';
            mktKpiBalanceCard.style.display = 'flex';
        } else {
            mktKpiReceivedCard.style.display = 'none';
            mktKpiBalanceCard.style.display = 'none';
        }
    }
    const mktCostBreakdownEl = document.getElementById('mktCostBreakdown');
    if (mktCostBreakdownEl) {
        mktCostBreakdownEl.textContent = `Ads: ${formatCurrency(totalMktCost)} - Phí QL: ${formatCurrency(totalAdFee)}`;
    }

    const totalRevEl = document.getElementById('mktTổngDoanhSố');
    if (totalRevEl) animateValue(totalRevEl, 0, totalRev, 800, formatCurrency);

    const mktMessEl = document.getElementById('mktTổngTinNhắn');
    if (mktMessEl) animateValue(mktMessEl, 0, totalMessages, 800, val => val.toLocaleString('vi-VN'));

    const mktCPMessEl = document.getElementById('mktCpmess');
    if (mktCPMessEl) {
        mktCPMessEl.textContent = totalMessages > 0 ? `Cost/Mess: ${formatCurrency(totalCost / totalMessages)}` : '0';
    }

    const totalData = dataNangCo + dataMuiChi + dataKhac;
    const mktTotalDataEl = document.getElementById('mktTổngData');
    if (mktTotalDataEl) {
        animateValue(mktTotalDataEl, 0, totalData, 800, val => val.toLocaleString('vi-VN'));
    }
    const mktCpDataEl = document.getElementById('mktCpData');
    if (mktCpDataEl) {
        mktCpDataEl.textContent = totalData > 0 ? `Cost/Data: ${formatCurrency(totalCost / totalData)}` : '0';
    }

    document.getElementById('mktTỷLệChiPhí').textContent = roas + '%';
    document.getElementById('mktTỷLệTới').textContent = formatCurrency(avgCostPerCus);

    // Update charts
    renderMarketingFunnelChart('mktFunnelNangCo', dataNangCo, henNangCo, toiNangCo);
    renderMarketingFunnelChart('mktFunnelMuiChi', dataMuiChi, henMuiChi, toiMuiChi);
    renderMarketingPieCharts(totalCost, totalRev, toiNangCo, toiMuiChi, toiKhac);
    renderMarketingTrends(data);
    renderMoMComparison(state.marketingData);
    renderPeriodAnalysis(state.marketingData);

    // Table
    document.getElementById('mktTableBody').innerHTML = tableHtml;
}

// ─── Render Trend Chart ───
function renderMarketingTrends(data) {
    const ctx = document.getElementById('mktTrendChart');
    if (!ctx) return;

    if (window.mktTrendChartInstance) {
        window.mktTrendChartInstance.destroy();
    }

    if (!data || data.length === 0) return;

    // Chart needs chronological order (oldest -> newest)
    const chartData = [...data].reverse();

    const labels = chartData.map(d => formatDateShort(d.date));

    const costs = chartData.map(d => d.cost / 1000000); // in millions
    const datas = chartData.map(d => (d.data_nangco || 0) + (d.data_muichi || 0) + (d.data_khac || 0));
    const arrived = chartData.map(d => (d.toi_nangco || 0) + (d.toi_muichi || 0) + (d.toi_khac || 0));

    window.mktTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Chi phí (Triệu)',
                    data: costs,
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.1)',
                    yAxisID: 'y',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Số Data',
                    data: datas,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.4
                },
                {
                    label: 'Khách Tới',
                    data: arrived,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { position: 'bottom' }
            },
            scales: {
                x: {
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: false, text: 'Chi phí (Tr)' },
                    beginAtZero: true
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: false, text: 'Số lượng' },
                    grid: { drawOnChartArea: false },
                    beginAtZero: true
                }
            }
        }
    });
}

// ─── Render MoM Comparison ───
function renderMoMComparison(rawData) {
    const container = document.getElementById('momComparison');
    if (!container) return;
    if (!rawData || rawData.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);">Không có đủ dữ liệu</div>';
        return;
    }

    const thisMonthData = filterDataByDate(rawData, 'date', 'month');
    const lastMonthData = filterDataByDate(rawData, 'date', 'lastmonth');

    const calc = (arr) => {
        let rev = 0, cost = 0, msg = 0, data = 0, arrived = 0;
        for (const item of arr) {
            rev += item.revenue || 0;
            cost += item.cost || 0;
            msg += item.messages || 0;
            data += (item.data_nangco || 0) + (item.data_muichi || 0) + (item.data_khac || 0);
            arrived += (item.toi_nangco || 0) + (item.toi_muichi || 0) + (item.toi_khac || 0);
        }
        const cpd = data > 0 ? cost / data : 0;
        return { rev, cost, msg, data, arrived, cpd };
    };

    const cur = calc(thisMonthData);
    const prev = calc(lastMonthData);

    const getChange = (currVal, prevVal, isGoodIfHigher) => {
        if (prevVal === 0) return { pct: 0, str: '--', cls: 'neutral' };
        const diff = currVal - prevVal;
        const pct = (diff / prevVal) * 100;
        const absPct = Math.abs(pct).toFixed(1);

        let cls = 'neutral';
        let arrow = '';
        if (diff > 0) {
            arrow = '▲';
            cls = isGoodIfHigher ? 'good' : 'bad';
        } else if (diff < 0) {
            arrow = '▼';
            cls = isGoodIfHigher ? 'bad' : 'good';
        } else {
            return { pct: 0, str: '-', cls: 'neutral' };
        }
        return { pct, str: `${arrow} ${absPct}%`, cls };
    };

    const metrics = [
        { label: 'Chi phí MKT', c: cur.cost, p: prev.cost, fmt: formatCurrency, goodUp: false },
        { label: 'Doanh số', c: cur.rev, p: prev.rev, fmt: formatCurrency, goodUp: true },
        { label: 'Tin nhắn', c: cur.msg, p: prev.msg, fmt: val => val.toLocaleString('vi-VN'), goodUp: true },
        { label: 'Tổng Data', c: cur.data, p: prev.data, fmt: val => val.toLocaleString('vi-VN'), goodUp: true },
        { label: 'Khách Tới', c: cur.arrived, p: prev.arrived, fmt: val => val.toLocaleString('vi-VN'), goodUp: true },
        { label: 'Giá/Data', c: cur.cpd, p: prev.cpd, fmt: formatCurrency, goodUp: false },
    ];

    let html = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;">`;

    for (const m of metrics) {
        const change = getChange(m.c, m.p, m.goodUp);
        const colorHtml = change.cls === 'good' ? 'color:var(--accent-emerald)' :
            change.cls === 'bad' ? 'color:var(--accent-red)' : 'color:var(--text-muted)';

        html += `
            <div style="background:var(--bg-secondary); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:4px;">${m.label}</div>
                <div style="font-size:16px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">${m.fmt(m.c)}</div>
                <div style="font-size:12px; font-weight:600; ${colorHtml}">${change.str}</div>
            </div>
        `;
    }
    html += `</div>`;

    container.innerHTML = html;
}

// ─── Render Period Analysis ───
function renderPeriodAnalysis(rawData) {
    const container = document.getElementById('mktPeriodAnalysis');
    if (!container) return;

    // Lọc lấy dữ liệu của tháng hiện tại
    const thisMonthData = filterDataByDate(rawData, 'date', 'month');
    if (!thisMonthData || thisMonthData.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);">Không có đủ dữ liệu</div>';
        return;
    }

    const periods = {
        dau_thang: { label: 'Đầu tháng (1-10)', data: [] },
        giua_thang: { label: 'Giữa tháng (11-20)', data: [] },
        cuoi_thang: { label: 'Cuối tháng (21+)', data: [] }
    };

    for (const item of thisMonthData) {
        const d = item.date.getDate();
        if (d <= 10) periods.dau_thang.data.push(item);
        else if (d <= 20) periods.giua_thang.data.push(item);
        else periods.cuoi_thang.data.push(item);
    }

    const calc = (arr) => {
        let cost = 0, data = 0, msg = 0;
        for (const item of arr) {
            cost += item.cost || 0;
            msg += item.messages || 0;
            data += (item.data_nangco || 0) + (item.data_muichi || 0) + (item.data_khac || 0);
        }
        const days = arr.length || 1;
        return {
            avgCost: cost / days,
            avgData: (data / days).toFixed(1),
            cpd: data > 0 ? (cost / data) : 0
        };
    };

    let html = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">`;

    for (const key of ['dau_thang', 'giua_thang', 'cuoi_thang']) {
        const p = periods[key];
        const c = calc(p.data);

        html += `
            <div style="background:var(--bg-secondary); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="font-size:12px; color:var(--text-primary); font-weight:700; margin-bottom:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:6px;">${p.label}</div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <span style="font-size:11px; color:var(--text-muted);">Chi phí/ngày:</span>
                    <span style="font-size:12px; font-weight:600;">${formatCurrency(c.avgCost)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <span style="font-size:11px; color:var(--text-muted);">Data/ngày:</span>
                    <span style="font-size:12px; font-weight:600;">${c.avgData}</span>
                </div>
                 <div style="display:flex; justify-content:space-between;">
                    <span style="font-size:11px; color:var(--text-muted);">Giá 1 Data:</span>
                    <span style="font-size:12px; font-weight:700; color:var(--accent-purple);">${formatCurrency(c.cpd)}</span>
                </div>
            </div>
        `;
    }
    html += `</div>`;
    container.innerHTML = html;
}

// ─── Auto Refresh ───
function animateValue(obj, start, end, duration, formatter = val => val) {
    if (!obj) return;
    let startTimestamp = null;
    const isNegative = end < start;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = isNegative
            ? Math.ceil(start - progress * (start - end))
            : Math.floor(progress * (end - start) + start);
        obj.textContent = formatter(current);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

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

// ─── Setup Pull To Refresh ───
function setupPullToRefresh() {
    let startY = 0;
    let currentY = 0;
    let isRefreshing = false;
    let isPulling = false;

    let ptrEl = document.getElementById('pullToRefresh');
    if (!ptrEl) {
        ptrEl = document.createElement('div');
        ptrEl.id = 'pullToRefresh';
        ptrEl.className = 'ptr-element';
        ptrEl.innerHTML = '⬇️ Kéo xuống để tải lại';
        document.body.prepend(ptrEl);
    }

    document.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0) {
            startY = e.touches[0].clientY;
            isPulling = true;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isPulling || isRefreshing) return;
        currentY = e.touches[0].clientY;
        const pullDistance = currentY - startY;

        if (pullDistance > 0 && window.scrollY === 0) {
            if (e.cancelable) e.preventDefault();
            ptrEl.style.transform = `translateY(${Math.min(pullDistance - 50, 10)}px)`;
            ptrEl.style.opacity = Math.min(pullDistance / 80, 1);

            if (pullDistance > 70) {
                ptrEl.innerHTML = '🔄 Thả ra để tải lại...';
            } else {
                ptrEl.innerHTML = '⬇️ Kéo xuống để tải lại';
            }
        }
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (!isPulling || isRefreshing) return;
        isPulling = false;

        const pullDistance = currentY - startY;
        if (pullDistance > 70 && window.scrollY === 0) {
            isRefreshing = true;
            ptrEl.innerHTML = '🔄 Đang tải dữ liệu...';
            ptrEl.classList.add('ptr-refreshing');

            // Refresh logic
            loadData().finally(() => {
                isRefreshing = false;
                ptrEl.style.transform = 'translateY(-50px)';
                ptrEl.style.opacity = '0';
                setTimeout(() => {
                    ptrEl.classList.remove('ptr-refreshing');
                }, 200);
            });
        } else {
            ptrEl.style.transform = 'translateY(-50px)';
            ptrEl.style.opacity = '0';
        }
        currentY = 0;
        startY = 0;
    });
}

// ─── Event Listeners ───
function setupEvents() {
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

    // Always use light theme
    document.body.classList.add('light-theme');

    // Connect immediately
    connectSheet();

    // Start auto-refresh if toggle is checked
    if (els.autoRefreshToggle.checked) {
        startAutoRefresh();
    }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
