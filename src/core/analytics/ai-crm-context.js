import { dateKey, numeric } from './budget-intelligence.js';

// CRM sources are event counts, not an attributed acquisition cohort.
export function buildCrmContext(model, snapshot = {}) {
    const start = dateKey(model.selectedRange?.start) || `${model.monthKey}-01`;
    const limits = [dateKey(model.selectedRange?.end), dateKey(model.cutoffKey)].filter(Boolean);
    const end = limits.sort()[0] || null;
    const sources = {};
    for (const source of ['leads', 'booked', 'arrived']) {
        const records = snapshot?.[source];
        if (!Array.isArray(records)) {
            sources[source] = { available: false, count: null, revenue: null, byDate: {}, missingDateCount: null };
            continue;
        }
        let count = 0, missingDateCount = 0, revenue = null, missingRevenueCount = 0;
        const byDate = {};
        for (const row of records) {
            const day = dateKey(source === 'leads' ? row.date : row.aptDate || row.date);
            if (!day) { missingDateCount++; continue; }
            if (!end || day < start || day > end) continue;
            count++;
            byDate[day] = (byDate[day] || 0) + 1;
            if (source === 'arrived') {
                const amount = numeric(row.revenue);
                if (amount === null) missingRevenueCount++;
                else revenue = (revenue ?? 0) + amount;
            }
        }
        sources[source] = { available: true, count, revenue, missingRevenueCount, byDate, missingDateCount };
    }
    return { startDate: start, endDate: end, timezone: 'Asia/Ho_Chi_Minh', stale: Boolean(snapshot?.metadata?.stale),
        grain: 'event counts by source date; CRM revenue is separate from Marketing revenue', sources };
}
