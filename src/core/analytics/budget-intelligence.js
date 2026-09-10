// Calendar arithmetic is explicit: business days are Asia/Ho_Chi_Minh days.
export const PHASES = ['early', 'mid', 'late'];
const SERVICES = ['nangco', 'muichi', 'khac'];
const ONE_DAY = 86400000;
export const numeric = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export function dateKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = new Date(`${value}T12:00:00Z`);
        return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
    }
    const d = value instanceof Date ? value : new Date(value);
    if (value == null || !Number.isFinite(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}
export const dayDate = key => new Date(`${key}T12:00:00+07:00`);
export function shiftDay(key, days) { return new Date(new Date(`${key}T12:00:00Z`).getTime() + days * ONE_DAY).toISOString().slice(0, 10); }
export function cutoffDate(referenceDate = new Date(), days = 2) { return new Date(`${shiftDay(dateKey(referenceDate), -Math.max(0, days))}T23:59:59.999+07:00`); }
export function phaseOf(value) { const key = dateKey(value); if (!key) return null; const day = Number(key.slice(8)); return day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late'; }
const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
const keyAt = (month, day) => `${month}-${String(day).padStart(2, '0')}`;
const sum = values => { const numbers = values.map(numeric).filter(v => v !== null); return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null; };
const median = values => { const a = values.filter(v => v !== null && Number.isFinite(v)).sort((a, b) => a - b); return !a.length ? null : a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };
const issue = (code, message, severity = 'warning', key) => ({ code, message, severity, ...(key ? { dateKey: key } : {}) });

export function normalizeMarketingRecord(record, referenceDate = new Date()) {
    const key = dateKey(record.dateKey || record.date);
    const output = { ...record, dateKey: key, monthKey: key?.slice(0, 7), phase: phaseOf(key) };
    const issues = [];
    for (const field of ['marketing_cost', 'ad_management_fee', 'cost', 'revenue', 'messages']) output[field] = numeric(record[field]);
    for (const [prefix, group, total] of [['data', 'dataByService', 'dataTotal'], ['hen', 'bookedByService', 'bookedTotal'], ['toi', 'arrivedByService', 'arrivedTotal']]) {
        output[group] = Object.fromEntries(SERVICES.map(service => [service, numeric(record[`${prefix}_${service}`])]));
        for (const service of SERVICES) output[`${prefix}_${service}`] = output[group][service];
        const values = Object.values(output[group]);
        output[total] = values.every(v => v !== null) ? sum(values) : null;
        if (output[total] === null) issues.push(issue('MISSING_FUNNEL', `Thiếu dữ liệu ${total} ở ${key || 'ngày không hợp lệ'}`, 'critical', key));
        if (values.some(v => v !== null && (v < 0 || !Number.isInteger(v)))) issues.push(issue('INVALID_COUNT', 'Số lượng âm hoặc không nguyên', 'critical', key));
    }
    if (!key) issues.push(issue('INVALID_DATE', 'Ngày không hợp lệ', 'critical'));
    for (const field of ['marketing_cost', 'cost', 'revenue']) {
        if (output[field] === null) issues.push(issue('MISSING_VALUE', `Thiếu ${field}`, 'critical', key));
        else if (output[field] < 0) issues.push(issue('NEGATIVE_VALUE', `${field} âm; cần đối soát`, 'critical', key));
    }
    if (output.cost !== null && output.marketing_cost !== null && output.cost < output.marketing_cost) issues.push(issue('COST_MISMATCH', 'Tổng chi nhỏ hơn chi Ads', 'critical', key));
    if (output.ad_management_fee !== null && output.cost !== null && output.marketing_cost !== null && Math.abs(output.cost - output.marketing_cost - output.ad_management_fee) > 1) issues.push(issue('COST_MISMATCH', 'Ads + phí quản lý không khớp tổng chi', 'critical', key));
    if (output.arrivedTotal > 0 && output.revenue === 0) issues.push(issue('ZERO_REVENUE', 'Có khách tới nhưng doanh thu bằng 0; kiểm tra trước khi tăng chi', 'warning', key));
    if (key > dateKey(referenceDate)) issues.push(issue('FUTURE_DAY', 'Ngày tương lai', 'info', key));
    output.dataCompleteness = { complete: !issues.some(i => i.severity === 'critical'), issues };
    return output;
}

export function calculateEfficiency(m) {
    const ratio = (a, b) => a !== null && b > 0 ? a / b : null;
    return { roas: ratio(m.revenue, m.ads), costPerData: ratio(m.cost, m.data), costPerArrived: ratio(m.cost, m.arrived), leadToBooked: ratio(m.booked, m.data), bookedToArrived: ratio(m.arrived, m.booked) };
}
export function aggregatePhase(records = [], { expectedDays = records.length } = {}) {
    const rows = records.map(r => r.dataCompleteness ? r : normalizeMarketingRecord(r));
    const counts = new Map(); rows.forEach(r => counts.set(r.dateKey, (counts.get(r.dateKey) || 0) + 1));
    const unique = rows.filter(r => r.dateKey && counts.get(r.dateKey) === 1);
    const totals = Object.fromEntries(Object.entries({ ads: 'marketing_cost', cost: 'cost', revenue: 'revenue', data: 'dataTotal', booked: 'bookedTotal', arrived: 'arrivedTotal' }).map(([k, f]) => [k, sum(unique.map(r => r[f]))]));
    const completeDays = unique.filter(r => r.dataCompleteness.complete).length;
    return { ...totals, days: unique.length, expectedDays, completeDays, complete: expectedDays > 0 && completeDays === expectedDays, efficiency: calculateEfficiency(totals) };
}

// Historical windows match the same day offsets and never include the target month.
export function aggregateHistoricalPhases(records, { monthKey, startDay, endDay }) {
    const candidates = [...new Set(records.map(r => r.monthKey).filter(m => m && m < monthKey))].sort().slice(-12);
    const samples = candidates.map(month => {
        if (endDay > monthEnd(month)) return null;
        const rows = records.filter(r => r.monthKey === month && Number(r.dateKey.slice(8)) >= startDay && Number(r.dateKey.slice(8)) <= endDay);
        const aggregate = aggregatePhase(rows, { expectedDays: endDay - startDay + 1 });
        return { monthKey: month, ...aggregate };
    }).filter(m => m?.complete && m.ads > 0 && m.efficiency.roas !== null && m.efficiency.costPerArrived !== null && m.efficiency.bookedToArrived !== null && m.efficiency.leadToBooked !== null);
    return { months: samples.length, samples, candidates: candidates.length,
        roasMedian: median(samples.map(m => m.efficiency.roas)), cpaMedian: median(samples.map(m => m.efficiency.costPerArrived)),
        arrivalRateMedian: median(samples.map(m => m.efficiency.bookedToArrived)), bookingRateMedian: median(samples.map(m => m.efficiency.leadToBooked)),
        dailyAdsMedian: median(samples.map(m => m.ads / m.expectedDays)), dailyDataMedian: median(samples.map(m => m.data / m.expectedDays)),
        dailyBookedMedian: median(samples.map(m => m.booked / m.expectedDays)), dailyArrivedMedian: median(samples.map(m => m.arrived / m.expectedDays)) };
}

export function buildBudgetRecommendation(current, baseline, { adjustmentPercent = 10, issues = [], stale = false } = {}) {
    const reasons = [], warnings = issues.filter(i => i.severity !== 'info').map(i => i.message);
    let action = 'insufficient_data';
    const e = current.efficiency;
    if (stale) reasons.push('Dữ liệu cũ: xem lại sau khi tải thành công, chưa dùng để điều chỉnh chi.');
    else if (!current.expectedDays) reasons.push('Giai đoạn chưa có ngày chốt trong khoảng đang xem.');
    else if (!current.complete || issues.some(i => i.severity === 'critical')) reasons.push(`Dữ liệu đầy đủ ${current.completeDays}/${current.expectedDays} ngày; cần kiểm tra cảnh báo trước khi đề xuất.`);
    else if (!(current.ads > 0)) reasons.push('Không có chi Ads dương để tính mức điều chỉnh.');
    else if (baseline.months < 3) reasons.push(`Chỉ có ${baseline.months}/3 tháng lịch sử đủ dữ liệu cùng giai đoạn.`);
    else if (current.days < 3) { action = 'hold'; reasons.push('Mới có 1–2 ngày đủ dữ liệu; giữ và đánh giá lại sau 3 ngày.'); }
    else {
        const roasBad = e.roas < baseline.roasMedian * 0.9;
        const cpaBad = e.costPerArrived !== null && e.costPerArrived > baseline.cpaMedian * 1.1;
        const bookingBad = e.leadToBooked !== null && e.leadToBooked < baseline.bookingRateMedian * 0.8;
        const arrivalBad = e.bookedToArrived !== null && e.bookedToArrived < baseline.arrivalRateMedian * 0.8;
        const canIncrease = e.roas > baseline.roasMedian * 1.1 && e.costPerArrived !== null && e.costPerArrived <= baseline.cpaMedian * 1.1 && e.bookedToArrived !== null && e.bookedToArrived >= baseline.arrivalRateMedian * 0.9 && !bookingBad && !warnings.length;
        action = current.arrived === 0 || (roasBad && cpaBad) || bookingBad || arrivalBad ? 'decrease' : canIncrease ? 'increase' : 'hold';
        if (current.arrived === 0) reasons.push('Có chi phí nhưng chưa có khách tới trong giai đoạn đủ dữ liệu.');
        if (bookingBad || arrivalBad) reasons.push('Tỷ lệ funnel giảm trên 20% so với lịch sử; cần kiểm tra telesale và lịch hẹn.');
        reasons.push(`ROAS ${e.roas?.toFixed(2) ?? '—'}x / lịch sử ${baseline.roasMedian?.toFixed(2) ?? '—'}x.`, `Chi phí/khách tới ${e.costPerArrived == null ? '—' : Math.round(e.costPerArrived).toLocaleString('vi-VN')} đ / lịch sử ${Math.round(baseline.cpaMedian).toLocaleString('vi-VN')} đ.`);
        if (action === 'hold') reasons.push('Tín hiệu chưa đồng thuận hoặc có cảnh báo; giữ chi và kiểm tra lại sau 3 ngày đủ dữ liệu.');
    }
    const step = Math.min(10, Math.max(0, numeric(adjustmentPercent) ?? 10));
    const percent = action === 'increase' ? step : action === 'decrease' ? -step : action === 'hold' ? 0 : null;
    const currentDailyAds = current.complete && current.expectedDays ? current.ads / current.expectedDays : null;
    return { action, percent, currentDailyAds, suggestedDailyAds: currentDailyAds !== null && percent !== null ? currentDailyAds * (1 + percent / 100) : null,
        confidence: action === 'insufficient_data' ? 'Thấp' : baseline.months >= 5 && current.days >= 7 && !warnings.length ? 'Cao' : 'Trung bình', reasons, warnings, issues };
}

export function buildBudgetDecisionModel(records = [], options = {}) {
    const referenceDate = options.referenceDate || new Date(), today = dateKey(referenceDate), cutoff = cutoffDate(referenceDate, options.cutoffDays ?? 2), cutoffKey = dateKey(cutoff);
    const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(options.monthKey || '') ? options.monthKey : today.slice(0, 7);
    const rows = records.map(r => normalizeMarketingRecord(r, referenceDate));
    const rangeStart = dateKey(options.rangeStart) || `${monthKey}-01`, rangeEnd = dateKey(options.rangeEnd) || keyAt(monthKey, monthEnd(monthKey));
    const eligible = rows.filter(r => r.dateKey && r.dateKey <= cutoffKey);
    const phases = PHASES.map((phase, index) => {
        const lower = keyAt(monthKey, index * 10 + 1), upper = keyAt(monthKey, index === 2 ? monthEnd(monthKey) : (index + 1) * 10);
        const start = [lower, rangeStart].sort().at(-1), end = [upper, rangeEnd, cutoffKey].sort()[0];
        const expectedDays = start <= end ? Math.round((dayDate(end) - dayDate(start)) / ONE_DAY) + 1 : 0;
        const days = eligible.filter(r => r.dateKey >= start && r.dateKey <= end);
        const current = aggregatePhase(days, { expectedDays });
        const issues = days.flatMap(r => r.dataCompleteness.issues);
        const seen = new Set(); for (const row of days) { if (seen.has(row.dateKey)) issues.push(issue('DUPLICATE_DAY', 'Ngày trùng: loại khỏi tổng dùng để quyết định', 'critical', row.dateKey)); seen.add(row.dateKey); }
        if (expectedDays > seen.size) issues.push(issue('MISSING_DAY', `Thiếu ${expectedDays - seen.size} ngày trong khoảng chốt`, 'critical'));
        const baseline = aggregateHistoricalPhases(eligible, { monthKey, startDay: expectedDays ? Number(start.slice(8)) : index * 10 + 1, endDay: expectedDays ? Number(end.slice(8)) : Math.min((index + 1) * 10, monthEnd(monthKey)) });
        if (current.complete && baseline.months >= 3) {
            if (baseline.dailyAdsMedian > 0 && current.ads / expectedDays > baseline.dailyAdsMedian * 1.3) issues.push(issue('ADS_SPIKE', 'Chi Ads/ngày cao hơn median lịch sử trên 30%.'));
            for (const [field, base] of [['data', 'dailyDataMedian'], ['booked', 'dailyBookedMedian'], ['arrived', 'dailyArrivedMedian']]) if (current[field] === 0 && baseline[base] > 0) issues.push(issue('ZERO_FUNNEL', `${field} về 0 so với lịch sử có phát sinh.`));
        }
        if (options.crmAvailable && !options.crmStale) {
            const crm = (options.crmRecords || []).filter(r => { const key = dateKey(r.aptDate || r.date); return key && key >= start && key <= end; });
            const known = crm.filter(r => numeric(r.revenue) !== null);
            const crmRevenue = sum(known.map(r => r.revenue));
            if (crmRevenue !== null && current.revenue !== null && Math.abs(crmRevenue - current.revenue) > 1) issues.push(issue('SOURCE_DIFFERENCE', 'Doanh thu CRM và Marketing khác nhau trong cửa sổ ngày này; chưa có quy tắc quy nguồn, không tự bù số.'));
            if (known.some(r => numeric(r.revenue) > 0 && !seen.has(dateKey(r.aptDate || r.date)))) issues.push(issue('CRM_WITHOUT_MARKETING', 'Có doanh thu CRM ở ngày chưa có dòng Marketing.'));
        }
        if (!options.crmAvailable || options.crmStale) issues.push(issue('CRM_UNAVAILABLE', 'Chưa đối chiếu CRM hoặc snapshot CRM đã cũ.', 'info'));
        const rec = buildBudgetRecommendation(current, baseline, { ...options, issues });
        return { phase, start, end, current, baseline, ...rec, days };
    });
    const focus = monthKey === today.slice(0, 7) && rangeEnd >= today ? today : [rangeEnd, keyAt(monthKey, monthEnd(monthKey))].sort()[0];
    const active = phases.find(p => p.phase === phaseOf(focus)) || phases[0];
    const { action, percent, currentDailyAds, suggestedDailyAds, confidence, reasons, warnings, issues } = active;
    return { cutoffDate: cutoff, cutoffKey, monthKey, currentPhase: active.phase, historical: monthKey < today.slice(0, 7), stale: Boolean(options.stale), selectedRange: { start: rangeStart, end: rangeEnd },
        availableMonths: [...new Set([today.slice(0, 7), monthKey, ...eligible.map(r => r.monthKey)])].sort().reverse(),
        phases, recommendation: { action, percent, currentDailyAds, suggestedDailyAds, confidence, reasons, warnings, issues },
        excludedDays: rows.filter(r => r.monthKey === monthKey && (!r.dateKey || r.dateKey > cutoffKey)),
        invalidDateRows: rows.filter(r => !r.dateKey).length };
}
