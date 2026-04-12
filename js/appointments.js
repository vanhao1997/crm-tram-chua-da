/**
 * Appointments Module
 * Handles appointment table rendering, filtering, and overdue detection
 */

import { normalizeStatus, formatDateShort, formatDateFull } from './sheets-api.js';

/**
 * Check if a date is today
 */
function isToday(date) {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

/**
 * Check if a date is within this week (Mon-Sun)
 */
function isThisWeek(date) {
    if (!date) return false;
    const today = new Date();
    const startOfWeek = new Date(today);
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday = 0
    startOfWeek.setDate(today.getDate() - diff);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    return date >= startOfWeek && date <= endOfWeek;
}

/**
 * Check if a date is within this month
 */
function isThisMonth(date) {
    if (!date) return false;
    const today = new Date();
    return date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

/**
 * Check if a date is within last month
 */
function isLastMonth(date) {
    if (!date) return false;
    const today = new Date();
    let lastMonth = today.getMonth() - 1;
    let year = today.getFullYear();
    if (lastMonth < 0) {
        lastMonth = 11;
        year--;
    }
    return date.getMonth() === lastMonth && date.getFullYear() === year;
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status) {
    const normalized = normalizeStatus(status);
    const map = {
        booked: { class: 'badge--booked', icon: '✅', label: 'Đặt Hẹn' },
        rescheduled: { class: 'badge--rescheduled', icon: '🔄', label: 'Dời Lịch' },
        cancelled: { class: 'badge--cancelled', icon: '❌', label: 'Hủy Lịch' },
        arrived: { class: 'badge--arrived', icon: '🏥', label: 'Đã Đến' }
    };

    const info = map[normalized] || { class: 'badge--booked', icon: '📋', label: status };
    return `<span class="badge ${info.class}">${info.icon} ${info.label}</span>`;
}

/**
 * Copy phone to clipboard and show toast
 */
function copyPhone(phone) {
    const fullPhone = '0' + phone.replace(/^0/, '');
    navigator.clipboard.writeText(fullPhone).then(() => {
        window.showToast?.(`Đã copy: ${fullPhone}`, 'success');
    }).catch(() => {
        window.showToast?.('Không thể copy', 'error');
    });
}

// Make copyPhone global for inline onclick
window.copyPhone = copyPhone;

export let sortAscending = false;

/**
 * Render appointment table
 */
export function renderAppointmentTable(data, filter = 'today') {
    const tbody = document.getElementById('appointmentBody');
    const emptyState = document.getElementById('appointmentEmpty');
    const tableWrapper = document.getElementById('appointmentTableWrapper');
    const sortBtn = document.getElementById('sortDateBtn');

    if (!tbody) return;

    if (sortBtn && !sortBtn.hasAttribute('data-bound')) {
        sortBtn.addEventListener('click', () => {
            sortAscending = !sortAscending;
            sortBtn.innerHTML = `Ngày hẹn ${sortAscending ? '↑' : '↓'}`;
            // Find active filter
            const activeTab = document.querySelector('.filter-tab--active');
            renderAppointmentTable(data, activeTab ? activeTab.dataset.filter : 'today');
        });
        sortBtn.setAttribute('data-bound', 'true');
        sortBtn.innerHTML = `Ngày hẹn ${sortAscending ? '↑' : '↓'}`;
    }

    // Filter data based on selected tab
    let filtered = data.filter(item => {
        if (!item.aptDate) return false;

        switch (filter) {
            case 'today': return isToday(item.aptDate);
            case 'week': return isThisWeek(item.aptDate);
            case 'month': return isThisMonth(item.aptDate);
            case 'lastmonth': return isLastMonth(item.aptDate);
            case 'all': return true;
            default: return true;
        }
    });

    // Sort by appointment date, then time
    filtered.sort((a, b) => {
        const dateA = a.aptDate?.getTime() || 0;
        const dateB = b.aptDate?.getTime() || 0;
        if (dateA !== dateB) return sortAscending ? dateA - dateB : dateB - dateA;
        return sortAscending ? (a.time || '').localeCompare(b.time || '') : (b.time || '').localeCompare(a.time || '');
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'flex';
        document.querySelector('.data-table').style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    document.querySelector('.data-table').style.display = '';

    tbody.innerHTML = filtered.map((item, i) => `
    <tr>
      <td data-label="STT">${i + 1}</td>
      <td class="td-name" data-label="Tên KH">${escapeHtml(item.name)}</td>
      <td class="td-phone" data-label="SĐT" onclick="copyPhone('${item.phone}')" title="Click để copy">${formatPhoneDisplay(item.phone)}</td>
      <td class="td-service" data-label="Dịch vụ">${escapeHtml(item.service)}</td>
      <td data-label="Giờ hẹn">${escapeHtml(item.time || '--')}</td>
      <td data-label="Ngày hẹn">${formatDateShort(item.aptDate)}</td>
      <td data-label="Nhân viên">${escapeHtml(item.staff)}</td>
      <td data-label="Trạng thái">${getStatusBadge(item.status)}</td>
      <td class="td-note" data-label="Ghi chú" title="${escapeHtml(item.note)}">${escapeHtml(truncate(item.note, 40))}</td>
    </tr>
  `).join('');
}

/**
 * Get overdue appointments (appointment date has passed but customer not in "arrived" list)
 */
export function getOverdueAppointments(booked, arrived) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build set of phone numbers that have arrived
    const arrivedPhones = new Set();
    for (const item of arrived) {
        if (item.phone) {
            arrivedPhones.add(item.phone.replace(/^0/, ''));
        }
    }

    // Find booked items where:
    // 1. aptDate < today (past due)
    // 2. status is still "booked" or "rescheduled" (not cancelled)
    // 3. phone not in arrived list
    return booked.filter(item => {
        if (!item.aptDate) return false;

        const aptDate = new Date(item.aptDate);
        aptDate.setHours(0, 0, 0, 0);

        if (aptDate >= today) return false; // Not overdue yet

        const status = normalizeStatus(item.status);
        if (status === 'cancelled' || status === 'arrived') return false;

        const normalizedPhone = item.phone.replace(/^0/, '');
        if (arrivedPhones.has(normalizedPhone)) return false; // Already arrived

        return true;
    }).sort((a, b) => {
        // Sort by most recent overdue first
        return (b.aptDate?.getTime() || 0) - (a.aptDate?.getTime() || 0);
    });
}

/**
 * Render overdue list
 */
export function renderOverdueList(overdueData) {
    const list = document.getElementById('overdueList');
    const emptyState = document.getElementById('overdueEmpty');
    const countBadge = document.getElementById('overdueCount');

    if (!list) return;

    countBadge.textContent = overdueData.length;

    if (overdueData.length === 0) {
        list.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    list.style.display = 'flex';
    emptyState.style.display = 'none';

    const today = new Date();

    list.innerHTML = overdueData.map(item => {
        const daysDiff = Math.floor((today - item.aptDate) / (1000 * 60 * 60 * 24));
        return `
      <div class="overdue-item">
        <div class="overdue-item__name">${escapeHtml(item.name)}</div>
        <div class="overdue-item__phone" onclick="copyPhone('${item.phone}')" title="Click để copy">📞 ${formatPhoneDisplay(item.phone)}</div>
        <div class="overdue-item__meta">
          <span>Hẹn: ${formatDateFull(item.aptDate)}</span>
          <span class="overdue-item__days">${daysDiff} ngày trước</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${escapeHtml(item.service)}</div>
      </div>
    `;
    }).join('');
}


/* ─── Helpers ─── */

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatPhoneDisplay(phone) {
    if (!phone) return '--';
    const p = phone.replace(/^0/, '');
    if (p.length === 9) return `0${p.substring(0, 3)} ${p.substring(3, 6)} ${p.substring(6)}`;
    return '0' + p;
}
