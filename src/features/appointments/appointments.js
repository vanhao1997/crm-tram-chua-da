/**
 * Appointments Module
 * Handles appointment table rendering, filtering, and overdue detection
 */

import { normalizeStatus, formatDateShort, formatDateFull, formatPhoneDisplay, escapeHtml, formatNotes } from '../../core/api/sheets-api.js';

const SVGS = {
    PHONE: `<svg viewBox="0 0 133 133"><defs><path id="SVGID_1_" d="m102.661 130.5h-72.322c-15.375 0-27.839-12.464-27.839-27.839v-72.322c0-15.375 12.464-27.839 27.839-27.839h72.322c15.375 0 27.839 12.464 27.839 27.839v72.322c0 15.375-12.464 27.839-27.839 27.839z"/><clipPath id="SVGID_2_"><use href="#SVGID_1_"/></clipPath></defs><g><use fill="#00b771" href="#SVGID_1_"/><path clip-path="url(#SVGID_2_)" d="m102.661 130.5h-72.322c-15.375 0-27.839-12.464-27.839-27.839v-72.322c0-15.375 12.464-27.839 27.839-27.839h72.322c15.375 0 27.839 12.464 27.839 27.839v72.322c0 15.375-12.464 27.839-27.839 27.839z" fill="#00b771"/><path clip-path="url(#SVGID_2_)" d="m100.638 84.078v14.512c0 .986-.802 1.783-1.797 1.783h-7.187c-15.835 0-30.724-6.121-41.924-17.234s-17.368-25.886-17.368-41.599v-7.13c0-.987.802-1.783 1.797-1.783h14.398c1.869 0 3.486 1.189 4.013 2.936l3.737 15.463c.144.606-.036 1.26-.491 1.7l-4.684 4.54c-.91.88-1.162 2.223-.635 3.352 1.006 2.115 2.18 4.172 3.498 6.121 1.629 2.389 3.498 4.623 5.546 6.668 2.06 2.032 4.312 3.886 6.72 5.503 1.964 1.308 4.036 2.484 6.181 3.471 1.126.523 2.48.273 3.366-.63l5.366-5.432c.467-.475 1.15-.654 1.797-.464l14.925 4.314c1.64.605 2.742 2.174 2.742 3.909z" fill="#fff"/></g></svg>`,
    ZALO: `<svg viewBox="0 0 512.007 512.007"><circle style="fill:#E6EFF4;" cx="256.003" cy="256.003" r="256.003"/><path style="fill:#B6D1DD;" d="M385.581,107.256L385.581,107.256c-5.101-5.102-12.148-8.258-19.932-8.258H146.354 c-15.567,0-28.187,12.619-28.187,28.187v219.295c0,7.785,3.156,14.832,8.258,19.933l0,0l145.105,145.105 C405.682,503.489,512.001,392.169,512.001,256c0-8.086-0.393-16.081-1.126-23.976L385.581,107.256z"/><path style="fill:#41A0D7;" d="M365.647,98.999H146.353c-15.567,0-28.187,12.619-28.187,28.187v219.294 c0,15.567,12.619,28.187,28.187,28.187h43.971v38.334l53.377-38.334h121.946c15.567,0,28.187-12.619,28.187-28.187V127.185 C393.834,111.618,381.215,98.999,365.647,98.999z"/><path style="fill:#FFFFFF;" d="M393.834,340.942v-44.17c-5.73-5.85-13.714-9.484-22.55-9.484h-64.188l86.738-118.175V131.24 c-4.466-3.988-10.304-6.31-16.5-6.31h-131.2c-17.435,0-31.57,14.135-31.57,31.57s14.135,31.57,31.57,31.57h55.168L212,311.089 c-5.474,7.539-6.255,17.512-2.024,25.812c4.231,8.3,12.76,13.526,22.077,13.526h139.232 C380.121,350.426,388.104,346.792,393.834,340.942z"/></svg>`
};

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

    window.__appointmentData = filtered;

    tbody.innerHTML = filtered.map((item, i) => `
    <tr>
      <td data-label="STT">${i + 1}</td>
      <td class="td-name" data-label="Tên KH">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <span>${escapeHtml(item.name)}</span>
          <button class="btn btn--icon" onclick="window.shareAppointmentItem(${i})" style="width:26px;height:26px;border:none;background:rgba(56, 189, 248, 0.1);color:var(--accent-blue);" title="Chia sẻ thông tin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        </div>
      </td>
      <td class="td-phone" data-label="SĐT">
        <div style="display:flex; align-items:center; gap:8px;">
          <span onclick="copyPhone('${item.phone}')" title="Click để copy" style="cursor:pointer; margin-right:4px;">${formatPhoneDisplay(item.phone)}</span>
          <a class="action-btn action-btn--call" href="tel:0${item.phone.replace(/^0/, '')}" title="Gọi Điện Nhanh" onclick="event.stopPropagation();">
            ${SVGS.PHONE}
          </a>
          <a class="action-btn action-btn--zalo" href="https://zalo.me/0${item.phone.replace(/^0/, '')}" target="_blank" title="Chat Zalo Nhanh" onclick="event.stopPropagation();">
            ${SVGS.ZALO}
          </a>
        </div>
      </td>
      <td class="td-service" data-label="Dịch vụ">${escapeHtml(item.service)}</td>
      <td data-label="Giờ hẹn">${escapeHtml(item.time || '--')}</td>
      <td data-label="Ngày hẹn">${formatDateShort(item.aptDate)}</td>
      <td data-label="Nhân viên">${escapeHtml(item.staff)}</td>
      <td data-label="Trạng thái">${getStatusBadge(item.status)}</td>
      <td class="td-note" data-label="Ghi chú">${formatNotes(item.note)}</td>
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

    window.__overdueData = overdueData;

    const today = new Date();

    list.innerHTML = overdueData.map((item, index) => {
        const daysDiff = Math.floor((today - item.aptDate) / (1000 * 60 * 60 * 24));
        return `
      <div class="overdue-item">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
            <div class="overdue-item__name" style="margin-bottom:0;">${escapeHtml(item.name)}</div>
            <button class="btn btn--icon" onclick="window.shareOverdueItem(${index})" style="width:26px;height:26px;border:none;background:rgba(56, 189, 248, 0.1);color:var(--accent-blue);" title="Chia sẻ qua Zalo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </button>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <div class="overdue-item__phone" onclick="copyPhone('${item.phone}')" title="Click để copy" style="flex:1;">📞 ${formatPhoneDisplay(item.phone)}</div>
            <a class="action-btn action-btn--call" href="tel:0${item.phone.replace(/^0/, '')}" title="Gọi Điện Nhanh">
                ${SVGS.PHONE}
            </a>
            <a class="action-btn action-btn--zalo" href="https://zalo.me/0${item.phone.replace(/^0/, '')}" target="_blank" title="Chat Zalo Nhanh">
                ${SVGS.ZALO}
            </a>
        </div>
        <div class="overdue-item__meta">
          <span>Hẹn: ${formatDateFull(item.aptDate)}</span>
          <span class="overdue-item__days">${daysDiff} ngày trước</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${escapeHtml(item.service)}</div>
        ${item.note ? `<div style="font-size:12px;color:var(--text-primary);margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-subtle);word-wrap:break-word;">${formatNotes(item.note)}</div>` : ''}
      </div>
    `;
    }).join('');
}


/* ─── Helpers ─── */

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatNotes(noteStr) {
    if (!noteStr) return '';
    const str = String(noteStr);
    const lines = str.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length > 1) {
        return lines.map((l, i) => `<b>[${i + 1}]</b> ${escapeHtml(l)}`).join('<br>');
    }
    return escapeHtml(str);
}

// Global share appointment
window.shareAppointmentItem = function (index) {
    const item = window.__appointmentData[index];
    if (!item) return;

    const text = `📌 THÔNG TIN LỊCH HẸN
👤 Khách hàng: ${item.name}
📞 SĐT: 0${item.phone.replace(/^0/, '')}
⏰ Hẹn ngày: ${formatDateFull(item.aptDate)} lúc ${item.time || '--'}
Dịch vụ: ${item.service || 'Không có'}
Trạng thái: ${item.status || 'Chưa xác định'}
📝 Ghi chú:
${item.note || 'Không có'}
`;

    if (navigator.share) {
        navigator.share({
            title: 'Thông tin Lịch Hẹn',
            text: text
        }).catch(err => {
            console.log('Share failed:', err);
            navigator.clipboard.writeText(text).then(() => {
                window.showToast?.('Đã copy thông tin để dán vào Zalo', 'success');
            });
        });
    } else {
        navigator.clipboard.writeText(text).then(() => {
            window.showToast?.('Đã copy thông tin để dán vào Zalo', 'success');
        });
    }
};

// Global share
window.shareOverdueItem = function (index) {
    const item = window.__overdueData[index];
    if (!item) return;

    const today = new Date();
    const daysDiff = Math.floor((today - item.aptDate) / (1000 * 60 * 60 * 24));

    const text = `📌 KHÁCH QUÁ HẸN CHƯA ĐẾN (${daysDiff} ngày)
👤 Khách hàng: ${item.name}
📞 SĐT: 0${item.phone.replace(/^0/, '')}
⏰ Hẹn ngày: ${formatDateFull(item.aptDate)}
Dịch vụ: ${item.service || 'Không có'}
📝 Ghi chú:
${item.note || 'Không có'}
`;

    if (navigator.share) {
        navigator.share({
            title: 'Thông tin Khách Quá Hẹn',
            text: text
        }).catch(err => {
            console.log('Share failed:', err);
            navigator.clipboard.writeText(text).then(() => {
                window.showToast?.('Đã copy thông tin để dán vào Zalo', 'success');
            });
        });
    } else {
        navigator.clipboard.writeText(text).then(() => {
            window.showToast?.('Đã copy thông tin để dán vào Zalo', 'success');
        });
    }
};

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
