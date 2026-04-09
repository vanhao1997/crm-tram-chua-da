/**
 * Charts Module
 * Pure CSS/HTML charts for KPI, Funnel, Revenue, and Status
 */

import { normalizeStatus, formatCurrency } from './sheets-api.js';

/**
 * Render KPI cards with data
 */
export function renderKPICards(leads, booked, arrived) {
  const totalLead = leads.length;
  const totalBooked = booked.length;
  const totalArrived = arrived.length;
  const totalRevenue = arrived.reduce((sum, item) => sum + (Number(String(item.revenue || 0).replace(/[,.]/g, '')) || 0), 0);

  animateValue('kpiTotalLeadValue', totalLead);
  animateValue('kpiBookedValue', totalBooked);
  animateValue('kpiArrivedValue', totalArrived);

  const revenueEl = document.getElementById('kpiRevenueValue');
  if (revenueEl) {
    revenueEl.textContent = formatCurrency(totalRevenue);
  }
}

/**
 * Render funnel chart
 */
export function renderFunnelChart(leads, booked, arrived) {
  const container = document.getElementById('funnelChart');
  if (!container) return;

  const totalLead = leads.length || 1;
  const totalBooked = booked.length;
  const totalArrived = arrived.length;

  const bookedPct = ((totalBooked / totalLead) * 100).toFixed(1);
  const arrivedPct = ((totalArrived / totalLead) * 100).toFixed(1);

  container.innerHTML = `
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">📥 Tổng Lead</span>
        <span class="funnel-bar__value">${totalLead}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--lead" style="width: 100%">
          <span class="funnel-bar__percent">100%</span>
        </div>
      </div>
    </div>
    
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">📅 Đặt Hẹn</span>
        <span class="funnel-bar__value">${totalBooked}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--booked" style="width: ${bookedPct}%">
          ${parseFloat(bookedPct) > 15 ? `<span class="funnel-bar__percent">${bookedPct}%</span>` : ''}
        </div>
      </div>
    </div>
    
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">✅ Đã Đến</span>
        <span class="funnel-bar__value">${totalArrived}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--arrived" style="width: ${arrivedPct}%">
          ${parseFloat(arrivedPct) > 15 ? `<span class="funnel-bar__percent">${arrivedPct}%</span>` : ''}
        </div>
      </div>
    </div>
    
    <div class="funnel-rate">
      <div class="funnel-rate__label">Tỷ lệ chuyển đổi tổng</div>
      <div class="funnel-rate__value">${arrivedPct}%</div>
    </div>
  `;

  // Animate bars
  requestAnimationFrame(() => {
    container.querySelectorAll('.funnel-bar__fill').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  });
}

/**
 * Render revenue by service chart
 */
export function renderRevenueChart(arrived) {
  const container = document.getElementById('revenueChart');
  if (!container) return;

  // Group revenue by service
  const serviceRevenue = {};
  let totalRevenue = 0;

  for (const item of arrived) {
    const revenue = Number(String(item.revenue || 0).replace(/[,.]/g, '')) || 0;
    if (revenue <= 0) continue;

    const service = item.service || 'Khác';
    serviceRevenue[service] = (serviceRevenue[service] || 0) + revenue;
    totalRevenue += revenue;
  }

  // Sort by revenue descending
  const sorted = Object.entries(serviceRevenue)
    .sort(([, a], [, b]) => b - a);

  const maxRevenue = sorted.length > 0 ? sorted[0][1] : 1;

  const barsHtml = sorted.map(([service, revenue]) => {
    const pct = ((revenue / maxRevenue) * 100).toFixed(0);
    return `
      <div class="revenue-item">
        <div class="revenue-item__header">
          <span class="revenue-item__label">${escapeHtml(service)}</span>
          <span class="revenue-item__value">${formatCurrency(revenue)}</span>
        </div>
        <div class="revenue-item__bar">
          <div class="revenue-item__fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    ${barsHtml}
    <div class="revenue-total">
      <div class="revenue-total__label">Tổng doanh số</div>
      <div class="revenue-total__value">${formatCurrency(totalRevenue)}</div>
    </div>
  `;

  // Animate
  requestAnimationFrame(() => {
    container.querySelectorAll('.revenue-item__fill').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  });
}

/**
 * Render lead status distribution chart
 */
export function renderStatusChart(leads) {
  const container = document.getElementById('statusChart');
  if (!container) return;

  // Count statuses
  const statusCounts = {};
  for (const item of leads) {
    const status = normalizeStatus(item.status);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const statusConfig = {
    booked: { label: 'Đặt Hẹn', color: 'var(--status-booked)' },
    arrived: { label: 'Đã Đến', color: 'var(--status-arrived)' },
    rescheduled: { label: 'Dời Lịch', color: 'var(--status-rescheduled)' },
    cancelled: { label: 'Hủy Lịch', color: 'var(--status-cancelled)' },
    no_answer: { label: 'Không Nghe Máy', color: 'var(--accent-purple)' },
    disconnected: { label: 'Thuê Bao', color: 'var(--text-muted)' },
    failed: { label: 'Không Hoàn Thành', color: 'var(--accent-pink)' },
    other: { label: 'Khác', color: 'var(--text-muted)' }
  };

  const total = leads.length || 1;

  // Sort by count descending
  const sorted = Object.entries(statusCounts)
    .sort(([, a], [, b]) => b - a);

  container.innerHTML = sorted.map(([status, count]) => {
    const config = statusConfig[status] || statusConfig.other;
    const pct = ((count / total) * 100).toFixed(0);
    return `
      <div class="status-item">
        <div class="status-item__dot" style="background: ${config.color}"></div>
        <span class="status-item__label">${config.label}</span>
        <div class="status-item__bar-wrap">
          <div class="status-item__bar" style="width: ${pct}%; background: ${config.color}"></div>
        </div>
        <span class="status-item__count">${count}</span>
      </div>
    `;
  }).join('');

  // Animate
  requestAnimationFrame(() => {
    container.querySelectorAll('.status-item__bar').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = w; });
    });
  });
}

/* ─── Helpers ─── */

function animateValue(elementId, endValue) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const duration = 800;
  const startTime = performance.now();
  const startValue = 0;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(startValue + (endValue - startValue) * eased);

    el.textContent = current.toLocaleString('vi-VN');

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
