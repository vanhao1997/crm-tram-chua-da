const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value));
const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('vi-VN').format(Number(value));
const pct = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
const phaseNames = { early: 'Đầu tháng', mid: 'Giữa tháng', late: 'Cuối tháng' };
const actions = { increase: 'Tăng 10%', decrease: 'Giảm 10%', hold: 'Giữ nguyên', insufficient_data: 'Chưa đủ dữ liệu' };
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const chart = (title, values, color) => {
  const rows = values || [];
  const valid = value => value != null && value !== '' && Number.isFinite(Number(value));
  const max = Math.max(...rows.map(v => valid(v.value) ? Number(v.value) : 0), 1);
  return `<div class="budget-chart"><h3>${esc(title)}</h3><div class="budget-chart__bars">${rows.map(v => {
    const missing = !valid(v.value);
    return `<span class="${missing ? 'budget-chart__missing' : ''}" style="height:${missing ? 0 : Math.max(0, Number(v.value) / max * 100)}%;background:${color}" title="${esc(v.label)}: ${missing ? 'Thiếu dữ liệu' : esc(v.value)}"></span>`;
  }).join('')}</div><div class="budget-chart__labels">${rows.map(v => `<small>${esc(v.label)}</small>`).join('')}</div>${rows.some(v => !valid(v.value)) ? '<small>× Thiếu dữ liệu; giá trị 0 không có cột.</small>' : ''}</div>`;
};

export function renderBudgetView(model, options = {}) {
  const root = document.getElementById(options.targetId || 'budgetIntelligence');
  if (!root || !model) return;
  const rec = model.recommendation || {};
  root.innerHTML = `<div class="budget-view__head"><div><p class="eyebrow">BUDGET DECISION CENTER</p><h2 class="panel-title">Đề xuất ngân sách theo giai đoạn</h2><p class="panel-subtitle">${model.historical ? 'Đang xem lịch sử' : `Chốt dữ liệu đến ${esc(model.cutoffKey)}`}${model.stale ? ' · Dữ liệu cũ' : ''}</p></div><span class="decision-badge decision-badge--${esc(rec.action || 'insufficient_data')}" aria-label="Đề xuất">${actions[rec.action] || actions.insufficient_data}</span></div>
    <div class="budget-view__controls"><label for="budgetMonthSelect">Kỳ phân tích</label><select id="budgetMonthSelect" class="form-input"></select><button type="button" class="btn btn--secondary" data-budget-export>Xuất báo cáo</button></div>
    <div class="decision-summary"><div><span>Chi Ads/ngày hiện tại</span><strong>${money(rec.currentDailyAds)}</strong></div><div><span>Tham chiếu sau đề xuất</span><strong>${money(rec.suggestedDailyAds)}</strong></div><div><span>Độ tin cậy</span><strong>${rec.confidence || '—'}</strong></div></div>
    <div class="decision-reasons"><strong>Vì sao:</strong> ${(rec.reasons || []).map(esc).join(' · ') || 'Chưa đủ dữ liệu để kết luận.'}${rec.warnings?.length ? `<br><strong>Cảnh báo:</strong> ${rec.warnings.map(esc).join(' · ')}` : ''}<br><small>Tham chiếu tối đa ±10%, chỉ là hiệu quả tương đối; không phải cam kết lợi nhuận. Tỷ lệ cùng ngày không chứng minh quan hệ nhân quả. Ngày chốt D-2 là quy ước.</small></div>
    <div class="budget-charts">${chart('Chi Ads/ngày', (model.phases || []).flatMap(p => (p.days || []).map(d => ({label:d.dateKey,value:d.marketing_cost}))), '#10b981')}${chart('Doanh thu/ngày', (model.phases || []).flatMap(p => (p.days || []).map(d => ({label:d.dateKey,value:d.revenue}))), '#d4a72c')}</div>
    <div class="phase-table-wrap"><table class="phase-table"><thead><tr><th>Giai đoạn</th><th>Chi Ads</th><th>Doanh thu</th><th>ROAS</th><th>CP khách tới</th><th>Khách tới</th><th>So lịch sử</th><th>Đề xuất</th></tr></thead><tbody>${(model.phases || []).map(p => `<tr class="phase-row phase-row--${esc(p.action)}"><td data-label="Giai đoạn"><strong>${esc(phaseNames[p.phase] || p.phase)}</strong><small>${number(p.current?.completeDays)}/${number(p.current?.expectedDays)} ngày đủ dữ liệu</small></td><td data-label="Chi Ads">${money(p.current?.ads)}</td><td data-label="Doanh thu">${money(p.current?.revenue)}</td><td data-label="ROAS">${p.current?.efficiency?.roas == null ? '—' : `${Number(p.current.efficiency.roas).toFixed(2)}x`}</td><td data-label="CP khách tới">${money(p.current?.efficiency?.costPerArrived)}</td><td data-label="Khách tới">${number(p.current?.arrived)}</td><td data-label="So lịch sử">${p.baseline?.months ? `Median ${p.baseline.months} tháng` : 'Chưa đủ lịch sử'}</td><td data-label="Đề xuất"><span class="phase-action phase-action--${esc(p.action)}">${actions[p.action] || '—'}</span><details><summary>Chi tiết</summary><div>${(p.days || []).map(d => `<p>${esc(d.dateKey)} · Ads ${money(d.marketing_cost)} · Doanh thu ${money(d.revenue)} · ${d.dataCompleteness?.issues?.map(issue => esc(issue.message || issue.code || issue)).join(', ') || 'Đủ dữ liệu'}</p>`).join('') || 'Không có ngày hợp lệ.'}</div></details></td></tr>`).join('')}</tbody></table></div>
    <details class="budget-notes"><summary>Phương pháp và dữ liệu loại trừ</summary><p>Phân tích read-only, dùng baseline các tháng trước cùng giai đoạn. Ngày loại trừ: ${(model.excludedDays || []).map(d => esc(d.dateKey || 'không rõ')).join(', ') || 'Không có'}.</p></details>
    <div class="budget-view__issues">${(rec.issues || []).map(i => `<span class="budget-issue budget-issue--${esc(i.severity || 'info')}">${esc(i.message || i.code || i)}</span>`).join('')}</div>`;
  const select = root.querySelector('#budgetMonthSelect');
  (model.availableMonths || [model.monthKey]).filter(Boolean).forEach(month => { const o = document.createElement('option'); o.value = month; o.textContent = month; o.selected = month === model.monthKey; select?.append(o); });
  select?.addEventListener('change', e => options.onMonthChange?.(e.target.value));
  root.querySelector('[data-budget-export]')?.addEventListener('click', () => { const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bsn-budget-${model.monthKey || 'report'}.json`; a.click(); URL.revokeObjectURL(a.href); });
}
