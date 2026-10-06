/**
 * Appointment helpers kept compatible with the original dashboard.
 * The main renderer owns the table; this module owns overdue detection and
 * the legacy export for consumers that still import it.
 */

import { normalizeStatus, formatDateShort, formatDateFull } from '../../core/api/sheets-api.js';
import { formatPhone, hasConfirmedTime, normalizePhone, sortAppointments, toDate } from '../dashboard/ui-helpers.js';
import { dateKey } from '../../core/analytics/budget-intelligence.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function phone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits ? (digits.length === 9 ? `0${digits}` : digits) : '';
}

function isSamePhone(a, b) {
    const left = normalizePhone(a), right = normalizePhone(b);
    return Boolean(left && right && left === right);
}

export let sortAscending = false;

export function renderAppointmentTable(data = [], filter = 'all') {
    const tbody = document.getElementById('appointmentBody');
    const emptyState = document.getElementById('appointmentEmpty');
    const table = document.getElementById('appointmentTable');
    if (!tbody) return;
    const sorted = sortAppointments(data);
    if (!sorted.length) {
        tbody.innerHTML = '';
        if (table) table.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }
    if (table) table.style.display = '';
    if (emptyState) emptyState.style.display = 'none';
    window.__appointmentData = sorted;
    tbody.innerHTML = sorted.map((item, index) => `
      <tr data-record-index="${index}" data-record-type="appointments" tabindex="0">
        <td>${index + 1}</td>
        <td class="td-name">${escapeHtml(item.name || 'Chưa có tên')}</td>
        <td class="td-phone">${escapeHtml(formatPhone(item.phone))}</td>
        <td>${escapeHtml(item.service || 'Chưa xác định')}</td>
        <td>${hasConfirmedTime(item) ? escapeHtml(item.time) : 'Chưa xác định'}</td>
        <td>${formatDateShort(toDate(item.aptDate))}</td>
        <td>${escapeHtml(item.staff || 'Chưa xác định')}</td>
        <td>${escapeHtml(item.status || 'Chưa xác định')}</td>
        <td><button class="btn btn--icon row-action" type="button" data-action="copy-record" data-record-index="${index}" data-record-type="appointments" title="Copy thông tin"><img src="/icons/copy.svg" alt="" aria-hidden="true" /></button></td>
      </tr>
    `).join('');
}

export function getOverdueAppointments(booked = [], arrived = [], reference = new Date()) {
    const today = dateKey(reference);
    return (booked || [])
        .filter(item => {
            const aptDay = dateKey(item?.aptDate);
            if (!aptDay || aptDay >= today) return false;
            const status = normalizeStatus(item?.status);
            if (['cancelled', 'arrived', 'rescheduled'].includes(status)) return false;
            return !(arrived || []).some(visit => {
                if (item.appointmentId && visit.appointmentId === item.appointmentId) return true;
                const visitDay = dateKey(visit.aptDate || visit.date);
                if (!isSamePhone(item.phone, visit.phone) || !visitDay || visitDay < aptDay) return false;
                return visitDay === aptDay || (dateKey(item.date) && dateKey(item.date) === dateKey(visit.date));
            });
        })
        .sort((a, b) => (toDate(b.aptDate)?.getTime() || 0) - (toDate(a.aptDate)?.getTime() || 0));
}

export function renderOverdueList(overdueData = []) {
    const list = document.getElementById('overdueList');
    const emptyState = document.getElementById('overdueEmpty');
    const countBadge = document.getElementById('overdueCount');
    if (!list) return;
    if (countBadge) countBadge.textContent = overdueData.length.toLocaleString('vi-VN');
    if (!overdueData.length) {
        list.innerHTML = '';
        list.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }
    list.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';
    window.__overdueData = overdueData;
    list.innerHTML = overdueData.map((item, index) => {
        const date = toDate(item.aptDate);
        const days = date ? Math.max(1, Math.floor((Date.now() - date.getTime()) / 86400000)) : null;
        const normalizedPhone = phone(item.phone);
        return `
          <div class="overdue-item">
            <div class="overdue-item__name">${escapeHtml(item.name || 'Chưa có tên')}</div>
            <div class="overdue-item__phone">${escapeHtml(formatPhone(normalizedPhone) || 'Chưa có')}</div>
            <div class="overdue-item__meta">
              <span>Hẹn: ${formatDateFull(date)}</span>
              <span class="overdue-item__days">${days ? `${days} ngày trước` : 'Chưa xác định'}</span>
            </div>
            <div class="overdue-item__service">${escapeHtml(item.service || 'Chưa xác định')}</div>
            <button class="btn btn--icon row-action" type="button" data-overdue-index="${index}" title="Copy thông tin"><img src="/icons/copy.svg" alt="" aria-hidden="true" /></button>
          </div>
        `;
    }).join('');
}
