import { buildCrmContext } from '../../core/analytics/ai-crm-context.js';
import { numeric } from '../../core/analytics/budget-intelligence.js';

const analyses = new Map();
const controllers = new WeakMap();
export function initAiMarketingPanel({ modelProvider, crmProvider, targetId = 'aiMarketingSignals' } = {}) {
  const root = document.getElementById(targetId);
  if (!root) return;
  controllers.get(root)?.abort();
  const controller = new AbortController();
  controllers.set(root, controller);
  const payload = buildAggregatePayload(modelProvider?.() || {}, crmProvider?.() || {});
  const key = JSON.stringify(payload);
  let result = analyses.get(key), busy = false, error = '';
  const labels = { increase: 'Tăng 10%', decrease: 'Giảm 10%', hold: 'Giữ nguyên', insufficient_data: 'Chưa đủ dữ liệu' };
  const phases = { early: 'Đầu tháng', mid: 'Giữa tháng', late: 'Cuối tháng' };
  const add = (parent, tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    parent.append(node); return node;
  };
  function render() {
    root.replaceChildren();
    const head = add(root, 'div', null, 'ai-signals__head');
    const title = add(head, 'div');
    add(title, 'h2', 'AI Marketing Signals', 'panel-title');
    add(title, 'p', `Kỳ ${payload.period.monthKey || '—'} · ${phases[payload.period.phase] || '—'} · Chốt ${payload.period.cutoffDate || '—'}`);
    const run = add(head, 'button', busy ? 'Đang phân tích…' : 'Phân tích kỳ này', 'btn btn--secondary');
    run.disabled = busy;
    run.addEventListener('click', analyze);
    add(root, 'p', `Quy tắc hệ thống: ${labels[payload.guardrails.deterministicAction]} · Lịch sử: ${payload.historical.sampleMonths} mẫu hợp lệ`);
    const history = add(root, 'details', null, 'ai-history budget-notes');
    add(history, 'summary', `Lịch sử đối chiếu (${payload.historicalWindows.length} cửa sổ)`);
    if (payload.historicalWindows.length) {
      const table = add(add(history, 'div', null, 'phase-table-wrap'), 'table', null, 'phase-table');
      const columns = ['Kỳ', 'Giai đoạn', 'Cửa sổ', 'ROAS', 'CP khách tới'];
      const headRow = add(add(table, 'thead'), 'tr');
      for (const label of columns) add(headRow, 'th', label).scope = 'col';
      const body = add(table, 'tbody');
      for (const sample of payload.historicalWindows) {
        const row = add(body, 'tr');
        const values = [sample.monthKey || '—', phases[sample.phase] || '—',
          `${sample.startDate || '—'} đến ${sample.endDate || '—'}`,
          sample.roas == null ? '—' : `${Number(sample.roas).toFixed(2)}x`,
          sample.costPerArrived == null ? '—' : `${Math.round(sample.costPerArrived).toLocaleString('vi-VN')} đ`];
        values.forEach((value, index) => { add(row, 'td', value).dataset.label = columns[index]; });
      }
    } else add(history, 'p', 'Chưa có cửa sổ lịch sử đủ dữ liệu.');
    if (payload.guardrails.stale) add(root, 'p', 'Dữ liệu cũ: cần tải lại trước khi quyết định ngân sách.', 'ai-state');
    if (error) {
      add(root, 'p', error, 'ai-state ai-state--error');
      const fallback = add(root, 'section', null, 'ai-fallback');
      add(fallback, 'h3', 'Phân tích công thức vẫn khả dụng');
      add(fallback, 'p', `AI chưa phản hồi. Quyết định tham chiếu hiện tại vẫn là “${labels[payload.guardrails.deterministicAction] || 'Chưa đủ dữ liệu'}”; không thay đổi ngân sách tự động.`);
      const checks = add(fallback, 'ul');
      add(checks, 'li', `Đã dùng ${payload.historical.sampleMonths || 0} mẫu lịch sử hợp lệ và dữ liệu đến ngày chốt.`);
      add(checks, 'li', 'Kiểm tra API key, model và trạng thái provider trong Coolify trước khi thử lại.');
      add(checks, 'li', 'Chỉ điều chỉnh ngân sách sau khi đối chiếu ROAS, chi phí/khách tới và cảnh báo dữ liệu.');
    }
    if (!result) add(root, 'p', 'Chưa có phân tích cho dữ liệu hiện tại.', 'ai-state');
    else {
      add(root, 'h3', labels[result.action] || 'Chưa đủ dữ liệu');
      add(root, 'p', result.summary);
      add(root, 'p', `Độ tin cậy: ${({ high: 'Cao', medium: 'Trung bình', low: 'Thấp' })[result.confidence] || '—'} · ${result.generatedAt || '—'}`);
      if (result.action !== payload.guardrails.deterministicAction) add(root, 'p', 'AI khác quy tắc hệ thống. Cần kiểm tra bằng chứng trước khi thay đổi chi Ads.', 'ai-state');
      for (const signal of result.signals || []) {
        const section = add(root, 'section', null, 'ai-result');
        add(section, 'h4', signal.title);
        add(section, 'p', (signal.evidence || []).join(' · '));
        add(section, 'p', signal.impact);
      }
      add(root, 'h3', 'Việc cần làm tiếp theo');
      const steps = add(root, 'ol', null, 'ai-next-steps');
      for (const step of result.nextSteps || []) {
        const item = add(steps, 'li');
        add(item, 'strong', step.action);
        add(item, 'p', `Phụ trách: ${step.owner || 'Chưa xác định'} · Thời hạn: ${step.deadline || 'Chưa xác định'}`);
        add(item, 'p', step.reason);
      }
      for (const [heading, values] of [['Cần kiểm tra trước khi đổi chi Ads', result.checksBeforeChange], ['Giới hạn dữ liệu', result.dataLimitations]]) {
        add(root, 'h4', heading);
        const list = add(root, 'ul');
        for (const value of values || []) add(list, 'li', value);
      }
      const clear = add(root, 'button', 'Xóa phân tích phiên này', 'btn btn--secondary');
      clear.disabled = busy;
      clear.onclick = () => { analyses.delete(key); result = null; render(); };
    }
    const disclosure = add(root, 'details');
    add(disclosure, 'summary', 'Xem dữ liệu tổng hợp đã dùng');
    const pre = add(disclosure, 'pre', JSON.stringify(payload, null, 2));
    pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto;';
  }
  async function analyze() {
    if (busy) return;
    busy = true; error = ''; render();
    try {
      const response = await fetch('/api/marketing/ai-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ periodKey: payload.period.monthKey, payload }) });
      const body = await response.json();
      if (!response.ok || !body.ok || !body.analysis) throw new Error(typeof body.error === 'string' ? body.error : 'Không thể phân tích. Vui lòng thử lại.');
      result = body.analysis;
      if (analyses.size >= 12) analyses.delete(analyses.keys().next().value);
      analyses.set(key, result);
    } catch (failure) {
      if (!controller.signal.aborted) error = failure.message;
    } finally {
      busy = false;
      if (!controller.signal.aborted) render();
    }
  }
  render();
}
export function buildAggregatePayload(model = {}, crm = {}) {
  const safe = numeric;
  const activePhase = (model.phases || []).find(p => p.phase === model.currentPhase) || model.phases?.[0] || {};
  const current = activePhase.current || model.current || {};
  const eff = current.efficiency || {};
  const historical = activePhase.baseline || model.historical || {};
  const daily = (model.phases || []).flatMap(p => (p.days || []).map(d => ({
    date: d.dateKey || null, phase: p.phase || null,
    ads: safe(d.marketing_cost), managementFee: safe(d.ad_management_fee), totalCost: safe(d.cost),
    revenue: safe(d.revenue), data: safe(d.dataTotal), booked: safe(d.bookedTotal), arrived: safe(d.arrivedTotal),
    completeness: d.dataCompleteness?.complete ?? null,
    issues: (d.dataCompleteness?.issues || []).map(i => i.code || i.message).slice(0, 8)
  })));
  const issues = model.recommendation?.issues || [];
  const aggregateCrm = buildCrmContext(model, crm);
  const historicalWindows = (model.phases || []).flatMap(p => (p.baseline?.samples || [])
    .filter(sample => sample.monthKey < model.monthKey).slice(-12).map(sample => ({
      monthKey: sample.monthKey, startDate: sample.startDate || null, endDate: sample.endDate || null, phase: p.phase,
      ads: safe(sample.ads), revenue: safe(sample.revenue), totalCost: safe(sample.cost),
      data: safe(sample.data), booked: safe(sample.booked), arrived: safe(sample.arrived),
      completeDays: safe(sample.completeDays), expectedDays: safe(sample.expectedDays),
      roas: safe(sample.efficiency?.roas), costPerArrived: safe(sample.efficiency?.costPerArrived),
      bookingRate: safe(sample.efficiency?.leadToBooked), arrivalRate: safe(sample.efficiency?.bookedToArrived),
    })));
  const currentPhaseRecord = (model.phases || []).find(p => p.phase === model.currentPhase) || activePhase;
  return { period: { monthKey: model.monthKey || null, startDate: model.selectedRange?.start || null, endDate: model.selectedRange?.end || null, cutoffDate: model.cutoffKey || null, phase: model.currentPhase || null, phaseStartDate: currentPhaseRecord.start || null, phaseEndDate: currentPhaseRecord.end || null },
    current: { ads:safe(current.ads), managementFee:safe(current.managementFee), totalCost:safe(current.cost), revenue:safe(current.revenue), roas:safe(eff.roas), costPerData:safe(eff.costPerData), costPerArrived:safe(eff.costPerArrived), data:safe(current.data), booked:safe(current.booked), arrived:safe(current.arrived), bookingRate:safe(eff.leadToBooked), arrivalRate:safe(eff.bookedToArrived), completeDays:safe(current.completeDays), expectedDays:safe(current.expectedDays) },
    historical: { sampleMonths: historical.months || 0, phaseBaselines: (model.phases || []).map(p => ({ phase: p.phase, sampleMonths: p.baseline?.months || 0, roasMedian: safe(p.baseline?.roasMedian), costPerArrivedMedian: safe(p.baseline?.cpaMedian), bookingRateMedian: safe(p.baseline?.bookingRateMedian), arrivalRateMedian: safe(p.baseline?.arrivalRateMedian), dailyAdsMedian: safe(p.baseline?.dailyAdsMedian) })) }, daily: daily.slice(0, 62),
    crm: aggregateCrm,
    historicalWindows,
    dataQuality: { issues: issues.map(i => ({ code: i.code, severity: i.severity, date: i.dateKey || null })),
      excludedDays: model.excludedDays?.length || 0, invalidDateRows: model.invalidDateRows || 0 },
    guardrails: { deterministicAction: model.recommendation?.action || 'insufficient_data', stale: Boolean(model.stale), historicalSamples: historical.months || 0, criticalWarnings: issues.filter(i => i?.severity === 'critical').length },
    budgetRule:{ maxAdjustmentPercent:10, cutoffRule:'D-2' } };
}
