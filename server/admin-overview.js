import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_DIR,
  SPREADSHEET_ID,
  SHEETS_CONFIG,
  DEFAULT_TELESALE_LIST,
  buildCsvExportUrl,
} from './config.js';
import {
  parseCsvToRows,
  normalizePhone,
  formatPhoneDisplay,
  parseVnDateToIso,
  classifyStatus,
} from './sheets-parser.js';
import { getActiveTelesaleNames } from './auth.js';
import { getLocalStateSnapshot, isRecordDeletedInLocalState } from './google-sheets.js';
import {
  SERVER_ARRIVED_REVENUE_BY_PHONE,
  SERVER_MARKETING_DAILY_ROWS_2026,
} from './marketing-fallback.js';

export const MARKETING_SPREADSHEET_ID =
  process.env.MARKETING_SHEET_ID || '124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4';
export const MARKETING_SHEET_GID = process.env.MARKETING_SHEET_GID || '1227076939';

const CACHE_DIR = path.join(ROOT_DIR, 'server', 'data', 'cache');
const VALID_PERIODS = ['today', 'week', 'month', 'lastmonth', 'all', 'custom'];

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Parse số tiền / số liệu từ ô Google Sheet (VD: "13.000.000 ₫", "1.527.345 đ", "24,89%")
 */
export function parseVnNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const str = String(raw).trim();
  if (!str || /^#(?:REF!|DIV\/0!|VALUE!|N\/A|ERROR!|NAME\?)/i.test(str)) return null;

  // Loại bỏ đơn vị tiền tệ và khoảng trắng
  let cleaned = str.replace(/[₫đ%\s]/gi, '');
  if (!cleaned) return null;

  // Định dạng VN: "13.000.000" hoặc "1.080.083,5"
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+,\d+$/.test(cleaned)) {
    cleaned = cleaned.replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function shiftDay(isoDate, days) {
  const ms = Date.parse(`${isoDate}T12:00:00Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function lastDayOfMonth(yyyyMm) {
  const year = Number(yyyyMm.slice(0, 4));
  const month = Number(yyyyMm.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yyyyMm}-${String(last).padStart(2, '0')}`;
}

function dayCountBetween(startIso, endIso) {
  return (
    Math.round(
      (Date.parse(`${endIso}T12:00:00Z`) - Date.parse(`${startIso}T12:00:00Z`)) / 86400000
    ) + 1
  );
}

function isValidIsoDate(val) {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const d = new Date(`${val}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === val;
}

/**
 * Chuẩn hóa kỳ lọc theo múi giờ Việt Nam (Asia/Ho_Chi_Minh) — tương thích 100% với crm-tram-chua-da
 */
export function resolveOverviewPeriod(
  query = {},
  reference = new Date(),
  timezone = 'Asia/Ho_Chi_Minh'
) {
  const key = VALID_PERIODS.includes(query.period) ? query.period : 'month';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference);
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;

  let start = null;
  let end = null;

  if (key === 'today') {
    start = today;
    end = today;
  } else if (key === 'week') {
    const weekdayOffset = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    start = shiftDay(today, -weekdayOffset);
    end = shiftDay(start, 6);
  } else if (key === 'month') {
    const ym = today.slice(0, 7);
    start = `${ym}-01`;
    end = lastDayOfMonth(ym);
  } else if (key === 'lastmonth') {
    const prevDate = new Date(
      Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)
    );
    const prevYm = prevDate.toISOString().slice(0, 7);
    start = `${prevYm}-01`;
    end = lastDayOfMonth(prevYm);
  } else if (key === 'custom') {
    const from = isValidIsoDate(query.from) ? query.from : `${today.slice(0, 7)}-01`;
    const to = isValidIsoDate(query.to) && query.to >= from ? query.to : today;
    start = from;
    end = to;
  }

  const actualEnd = end && end < today ? end : today;
  return { key, start, end, actualEnd, today, timezone };
}

export function resolveComparisonPeriod(period) {
  if (!period.start || period.actualEnd < period.start) return null;
  const end = period.actualEnd;
  if (period.key === 'month' || period.key === 'lastmonth') {
    const prevDate = new Date(
      Date.UTC(Number(period.start.slice(0, 4)), Number(period.start.slice(5, 7)) - 2, 1)
    );
    const previousYm = prevDate.toISOString().slice(0, 7);
    const monthEnd = lastDayOfMonth(previousYm);
    const matchingEnd = `${previousYm}-${end.slice(8, 10)}`;
    return {
      key: period.key,
      start: `${previousYm}-01`,
      end: period.key === 'lastmonth' || matchingEnd > monthEnd ? monthEnd : matchingEnd,
      actualEnd: period.key === 'lastmonth' || matchingEnd > monthEnd ? monthEnd : matchingEnd,
      timezone: period.timezone,
    };
  }
  const offset =
    period.key === 'today' ? 1 : period.key === 'week' ? 7 : dayCountBetween(period.start, end);
  return {
    key: period.key,
    start: shiftDay(period.start, -offset),
    end: shiftDay(end, -offset),
    actualEnd: shiftDay(end, -offset),
    timezone: period.timezone,
  };
}

function inDateWindow(dateIso, windowPeriod, useActualEnd = false) {
  if (!dateIso) return false;
  if (!windowPeriod || !windowPeriod.start) {
    return useActualEnd && windowPeriod?.actualEnd ? dateIso <= windowPeriod.actualEnd : true;
  }
  const upperBound = useActualEnd ? windowPeriod.actualEnd : windowPeriod.end;
  return dateIso >= windowPeriod.start && (!upperBound || dateIso <= upperBound);
}

/**
 * Phân nhóm dịch vụ theo chuẩn crm-tram-chua-da:
 * 0: Nâng cơ | 1: Mũi chỉ / Mũi sợi | 2: Dịch vụ khác
 */
export function classifyServiceGroup(serviceText) {
  const text = String(serviceText || '')
    .trim()
    .toLocaleLowerCase('vi-VN');
  if (/nâng cơ|\bnc\b/.test(text)) return 'nangco';
  if (/mũi chỉ|mũi sợi/.test(text)) return 'muichi';
  return 'khac';
}

async function fetchCsvWithCache(url, cacheFileName) {
  ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, cacheFileName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CRM-BSN-AdminOverview/1.0',
        Accept: 'text/csv,text/plain,*/*',
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csvText = await res.text();
    if (csvText && csvText.length > 20 && !csvText.trim().startsWith('<!DOCTYPE html')) {
      fs.writeFileSync(cachePath, csvText, 'utf8');
      return { csvText, stale: false };
    }
    throw new Error('Invalid CSV');
  } catch {
    if (fs.existsSync(cachePath)) {
      return { csvText: fs.readFileSync(cachePath, 'utf8'), stale: true };
    }
    return { csvText: '', stale: true };
  }
}

/**
 * Đọc dữ liệu CRM thô có giữ nguyên Cột W (Doanh số) dành riêng cho Admin
 */
function parseAdminCrmRows(csvText, sheetKey, knownTelesales = []) {
  const rows = parseCsvToRows(csvText);
  const items = [];
  const knownSet = new Set(knownTelesales.map((s) => String(s || '').trim().toUpperCase()));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sheetRowIndex = i + 1;
    const colB = String(row[1] || '').trim();
    const colC = String(row[2] || '').trim();
    const colD = String(row[3] || '').trim();
    const colE = String(row[4] || '').trim();
    const colF = String(row[5] || '').trim();

    if (
      sheetRowIndex === 1 ||
      colB.toUpperCase() === 'NGÀY DATA' ||
      colC.toUpperCase() === 'TÊN KHÁCH HÀNG' ||
      /^(HỌ TÊN|HỌ VÀ TÊN|TÊN KH)$/i.test(colC)
    ) {
      continue;
    }

    const phone = normalizePhone(colD);
    if (!colC && phone.length < 8) continue;

    const rawStatus = String(row[8] || '').trim();
    const apptTime = String(row[9] || '').trim();
    const apptDate = String(row[10] || '').trim();
    const rawColL = String(row[11] || '').trim();
    const rawColM = String(row[12] || '').trim();

    let telesale = '';
    let noteM = rawColM;
    const upperL = rawColL.toUpperCase();
    if (rawColL) {
      const looksLikeNote =
        rawColL.length > 18 ||
        /\d{1,2}\/\d{1,2}/.test(rawColL) ||
        /\d{1,2}h\d{0,2}/i.test(rawColL) ||
        rawColL.includes(',') ||
        rawColL.split(/\s+/).length > 4;
      if (knownSet.has(upperL) || !looksLikeNote) {
        telesale = upperL;
      } else {
        noteM = rawColM || rawColL;
      }
    }

    // Trích xuất Doanh số ở Cột W (index 22) hoặc Cột V (index 21) cho Admin
    const rawRevW = row[22];
    const rawRevV = row[21];
    let revenue = parseVnNumber(rawRevW) ?? parseVnNumber(rawRevV);
    if (revenue === null && sheetKey === 'arrived') {
      for (let colIdx = 18; colIdx <= 25; colIdx++) {
        const cellVal = row[colIdx];
        if (cellVal !== undefined && cellVal !== null && !/^(thứ|chủ|chúa)/i.test(String(cellVal).trim())) {
          const parsed = parseVnNumber(cellVal);
          if (parsed !== null && parsed >= 100000) {
            revenue = parsed;
            break;
          }
        }
      }
      if (revenue === null && phone && SERVER_ARRIVED_REVENUE_BY_PHONE[phone] !== undefined) {
        revenue = SERVER_ARRIVED_REVENUE_BY_PHONE[phone];
      }
    }

    const dataDateIso = parseVnDateToIso(colB);
    const apptDateIso = parseVnDateToIso(apptDate);
    const statusInfo = classifyStatus(sheetKey === 'arrived' && !rawStatus ? 'ĐÃ ĐẾN' : rawStatus);

    items.push({
      id: `${sheetKey}-row-${sheetRowIndex}`,
      sheetKey,
      sheetRowIndex,
      dataDate: colB,
      dataDateIso,
      name: colC || 'Khách chưa rõ tên',
      phone,
      phoneDisplay: formatPhoneDisplay(phone || colD),
      service: colE,
      serviceGroup: classifyServiceGroup(colE),
      source: colF || 'Ads FB Mess',
      customerInfo: String(row[7] || '').trim(),
      status: statusInfo.status,
      canonicalStatus: statusInfo.canonicalStatus,
      statusLabel: statusInfo.statusLabel,
      statusGroup: statusInfo.statusGroup,
      badgeColor: statusInfo.badgeColor,
      apptTime,
      apptDate,
      apptDateIso,
      telesale,
      noteM,
      revenue: revenue !== null && revenue >= 0 ? revenue : null,
      rawRevenueText: String(rawRevW || rawRevV || '').trim(),
    });
  }

  return items;
}

/**
 * Đọc bảng Tài chính Marketing (Sheet 2026 - GID 1227076939) từ mảng 2 chiều hoặc CSV
 */
export function parseMarketingRows(rowsOrCsv) {
  const rows = Array.isArray(rowsOrCsv) ? rowsOrCsv : parseCsvToRows(rowsOrCsv);
  const dailyRows = [];
  const monthlySummaries = {};
  let summaryBalance = null;
  let summaryReceived = null;
  let summaryCost = null;
  const formulaErrors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const colA = String(row[0] ?? '').trim();
    const colB = parseVnNumber(row[1]);
    const colC = parseVnNumber(row[2]);
    const colD = parseVnNumber(row[3]);
    const colE = parseVnNumber(row[4]);
    const colF = parseVnNumber(row[5]);

    // Dòng tổng kết ở đầu sheet (hàng 2 hoặc hàng 4: "TỔNG" hoặc rỗng) chứa Số dư còn (Col B)
    if (i <= 4 && (!colA || /^tổng$/i.test(colA)) && colB !== null) {
      summaryBalance = colB;
      summaryReceived = colC;
      summaryCost = colF;
    }

    // Dòng tổng kết từng tháng (VD: "THÁNG 10") trên Sheet 2026
    const monthMatch = colA.match(/^tháng\s*(\d{1,2})$/i);
    if (monthMatch) {
      const monthNum = Number(monthMatch[1]);
      if (monthNum >= 1 && monthNum <= 12) {
        const monthKey = `2026-${String(monthNum).padStart(2, '0')}`;
        monthlySummaries[monthKey] = {
          monthKey,
          label: colA,
          balance: colB,
          received: colC,
          ads: colD,
          fee: colE,
          cost: colF,
          messages: parseVnNumber(row[17]),
        };
      }
      continue;
    }

    const dateIso = parseVnDateToIso(colA);
    if (!dateIso || dateIso.length !== 10) continue;

    const hasFormulaErr = row.some(
      (cell) =>
        typeof cell === 'string' &&
        /^#(?:REF!|DIV\/0!|VALUE!|N\/A|ERROR!|NAME\?)/i.test(cell.trim())
    );
    if (hasFormulaErr) {
      formulaErrors.push({ row: i + 1, dateKey: dateIso });
    }

    const received = colC ?? 0;
    const ads = colD ?? 0;
    const fee = colE ?? 0;
    const cost = colF ?? (colD !== null || colE !== null ? ads + fee : 0);

    const dataNangCo = parseVnNumber(row[6]) ?? 0;
    const dataMuiChi = parseVnNumber(row[7]) ?? 0;
    const dataKhac = parseVnNumber(row[8]) ?? 0;

    const bookedNangCo = parseVnNumber(row[9]) ?? 0;
    const bookedMuiChi = parseVnNumber(row[10]) ?? 0;
    const bookedKhac = parseVnNumber(row[11]) ?? 0;

    const arrivedNangCo = parseVnNumber(row[12]) ?? 0;
    const arrivedMuiChi = parseVnNumber(row[13]) ?? 0;
    const arrivedKhac = parseVnNumber(row[14]) ?? 0;

    const revenue = parseVnNumber(row[15]) ?? 0;
    const messages = parseVnNumber(row[17]) ?? 0;

    dailyRows.push({
      rowIndex: i + 1,
      dateText: colA,
      dateIso,
      balance: colB,
      received,
      ads,
      fee,
      cost,
      rawAds: colD,
      rawFee: colE,
      rawCost: colF,
      dataByService: { nangco: dataNangCo, muichi: dataMuiChi, khac: dataKhac },
      dataTotal: dataNangCo + dataMuiChi + dataKhac,
      bookedByService: { nangco: bookedNangCo, muichi: bookedMuiChi, khac: bookedKhac },
      bookedTotal: bookedNangCo + bookedMuiChi + bookedKhac,
      arrivedByService: { nangco: arrivedNangCo, muichi: arrivedMuiChi, khac: arrivedKhac },
      arrivedTotal: arrivedNangCo + arrivedMuiChi + arrivedKhac,
      revenue,
      messages,
    });
  }

  // Đồng bộ sai số làm tròn thập phân (1-15 đồng khi xuất CSV từ Google Sheet) theo dòng tổng THÁNG X
  for (const [monthKey, mSum] of Object.entries(monthlySummaries)) {
    const activeRowsInMonth = dailyRows.filter(
      (r) => r.dateIso.startsWith(monthKey) && (r.ads > 0 || r.cost > 0 || r.received > 0)
    );
    if (activeRowsInMonth.length === 0) continue;
    const lastActive = activeRowsInMonth[activeRowsInMonth.length - 1];

    if (mSum.ads !== null && mSum.ads > 0) {
      const sumAds = activeRowsInMonth.reduce((acc, r) => acc + (r.ads || 0), 0);
      const diffAds = mSum.ads - sumAds;
      if (diffAds !== 0 && Math.abs(diffAds) <= 50) {
        lastActive.ads += diffAds;
        if (lastActive.rawAds !== null) lastActive.rawAds += diffAds;
      }
    }
    if (mSum.fee !== null && mSum.fee > 0) {
      const sumFee = activeRowsInMonth.reduce((acc, r) => acc + (r.fee || 0), 0);
      const diffFee = mSum.fee - sumFee;
      if (diffFee !== 0 && Math.abs(diffFee) <= 50) {
        lastActive.fee += diffFee;
        if (lastActive.rawFee !== null) lastActive.rawFee += diffFee;
      }
    }
    if (mSum.cost !== null && mSum.cost > 0) {
      const sumCost = activeRowsInMonth.reduce((acc, r) => acc + (r.cost || 0), 0);
      const diffCost = mSum.cost - sumCost;
      if (diffCost !== 0 && Math.abs(diffCost) <= 50) {
        lastActive.cost += diffCost;
        if (lastActive.rawCost !== null) lastActive.rawCost += diffCost;
      }
    }
    if (mSum.received !== null && mSum.received > 0) {
      const sumRec = activeRowsInMonth.reduce((acc, r) => acc + (r.received || 0), 0);
      const diffRec = mSum.received - sumRec;
      if (diffRec !== 0 && Math.abs(diffRec) <= 50) {
        lastActive.received += diffRec;
      }
    }
  }

  return {
    dailyRows,
    monthlySummaries,
    summaryBalance,
    summaryReceived,
    summaryCost,
    formulaErrors,
  };
}

function readCachedMarketingJson(jsonCachePath) {
  if (!fs.existsSync(jsonCachePath)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(jsonCachePath, 'utf8'));
    const dailyRows = (cached.dailyRows || []).map((r, idx) => ({
      rowIndex: idx + 5,
      dateText: r.dateText,
      dateIso: r.dateIso,
      balance: null,
      received: r.received || 0,
      ads: r.ads || 0,
      fee: r.fee || 0,
      cost: r.cost || 0,
      rawAds: r.ads ?? null,
      rawFee: r.fee ?? null,
      rawCost: r.cost ?? null,
      dataByService: {
        nangco: r.dataNangCo || 0,
        muichi: r.dataMuiChi || 0,
        khac: r.dataKhac || 0,
      },
      dataTotal: (r.dataNangCo || 0) + (r.dataMuiChi || 0) + (r.dataKhac || 0),
      bookedByService: {
        nangco: r.bookedNangCo || 0,
        muichi: r.bookedMuiChi || 0,
        khac: r.bookedKhac || 0,
      },
      bookedTotal: (r.bookedNangCo || 0) + (r.bookedMuiChi || 0) + (r.bookedKhac || 0),
      arrivedByService: {
        nangco: r.arrivedNangCo || 0,
        muichi: r.arrivedMuiChi || 0,
        khac: r.arrivedKhac || 0,
      },
      arrivedTotal: (r.arrivedNangCo || 0) + (r.arrivedMuiChi || 0) + (r.arrivedKhac || 0),
      revenue: r.revenue || 0,
      messages: r.messages || 0,
    }));
    if (dailyRows.length > 0) {
      return {
        parsed: {
          dailyRows,
          monthlySummaries: cached.monthlySummaries || {},
          summaryBalance: cached.summary?.balance ?? null,
          summaryReceived: cached.summary?.received ?? null,
          summaryCost: cached.summary?.cost ?? null,
          formulaErrors: [],
        },
        stale: true,
      };
    }
  } catch {
    // Ignore parse error
  }
  return null;
}

/**
 * Tải dữ liệu Sheet Tài chính Marketing 2026 trực tiếp từ Google Sheet (GID 1227076939)
 * kèm bộ nhớ đệm local (server/data/cache/marketing-2026.csv & marketing-2026.json)
 */
async function fetchMarketingDataWithCache() {
  ensureCacheDir();
  const jsonCachePath = path.join(CACHE_DIR, 'marketing-2026.json');

  // 1. Ưu tiên số 1: Tải trực tiếp CSV mới nhất từ Google Sheet Marketing 2026 (124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4, gid=1227076939)
  const financeUrl = buildCsvExportUrl(MARKETING_SPREADSHEET_ID, MARKETING_SHEET_GID);
  const csvRes = await fetchCsvWithCache(financeUrl, 'marketing-2026.csv');
  if (csvRes.csvText) {
    const parsed = parseMarketingRows(csvRes.csvText);
    if (parsed.dailyRows.length > 0) {
      if (!csvRes.stale) {
        try {
          const cacheObj = {
            summary: {
              balance: parsed.summaryBalance,
              received: parsed.summaryReceived,
              cost: parsed.summaryCost,
            },
            monthlySummaries: parsed.monthlySummaries || {},
            dailyRows: parsed.dailyRows.map((r) => ({
              dateText: r.dateText,
              dateIso: r.dateIso,
              received: r.received,
              ads: r.ads,
              fee: r.fee,
              cost: r.cost,
              dataNangCo: r.dataByService.nangco,
              dataMuiChi: r.dataByService.muichi,
              dataKhac: r.dataByService.khac,
              bookedNangCo: r.bookedByService.nangco,
              bookedMuiChi: r.bookedByService.muichi,
              bookedKhac: r.bookedByService.khac,
              arrivedNangCo: r.arrivedByService.nangco,
              arrivedMuiChi: r.arrivedByService.muichi,
              arrivedKhac: r.arrivedByService.khac,
              revenue: r.revenue,
              messages: r.messages,
            })),
          };
          fs.writeFileSync(jsonCachePath, JSON.stringify(cacheObj, null, 2), 'utf8');
        } catch {
          // Ignore cache write error
        }
      }
      return { parsed, stale: csvRes.stale };
    }
  }

  // 2. Dự phòng từ cache JSON đã lưu trên đĩa (server/data/cache/marketing-2026.json)
  const fromJsonCache = readCachedMarketingJson(jsonCachePath);
  if (fromJsonCache) {
    return fromJsonCache;
  }

  // 3. Dự phòng nội bộ phía Server (Backend-only) khi chưa có mạng hoặc cache đĩa
  const fallbackDailyRows = SERVER_MARKETING_DAILY_ROWS_2026.map((r, idx) => ({
    rowIndex: idx + 5,
    dateText: r.dateIso,
    dateIso: r.dateIso,
    balance: null,
    received: r.received || 0,
    ads: r.ads || 0,
    fee: r.fee || 0,
    cost: r.cost || 0,
    rawAds: r.ads ?? null,
    rawFee: r.fee ?? null,
    rawCost: r.cost ?? null,
    dataByService: { nangco: 0, muichi: 0, khac: 0 },
    dataTotal: 0,
    bookedByService: { nangco: 0, muichi: 0, khac: 0 },
    bookedTotal: 0,
    arrivedByService: { nangco: 0, muichi: 0, khac: 0 },
    arrivedTotal: 0,
    revenue: 0,
    messages: r.messages || 0,
  }));

  return {
    parsed: {
      dailyRows: fallbackDailyRows,
      monthlySummaries: {},
      summaryBalance: null,
      summaryReceived: null,
      summaryCost: null,
      formulaErrors: [],
    },
    stale: true,
  };
}

const OVERVIEW_CACHE_TTL_MS = 60 * 1000;
let overviewSourcesCache = {
  fetchedAt: 0,
  mktRes: null,
  bookedRes: null,
  arrivedRes: null,
  mktSheetRes: null,
};
let inFlightOverviewPromise = null;

function warmOverviewCacheFromDisk() {
  try {
    ensureCacheDir();
    const mktPath = path.join(CACHE_DIR, 'mkt.csv');
    const bookedPath = path.join(CACHE_DIR, 'booked.csv');
    const arrivedPath = path.join(CACHE_DIR, 'arrived.csv');
    const mktSheetCsvPath = path.join(CACHE_DIR, 'marketing-2026.csv');
    const jsonCachePath = path.join(CACHE_DIR, 'marketing-2026.json');

    if (fs.existsSync(mktPath) && fs.existsSync(bookedPath) && fs.existsSync(arrivedPath)) {
      const mktCsv = fs.readFileSync(mktPath, 'utf8');
      const bookedCsv = fs.readFileSync(bookedPath, 'utf8');
      const arrivedCsv = fs.readFileSync(arrivedPath, 'utf8');
      let mktSheetRes = null;
      if (fs.existsSync(mktSheetCsvPath)) {
        const rawMktCsv = fs.readFileSync(mktSheetCsvPath, 'utf8');
        const parsed = parseMarketingRows(rawMktCsv);
        if (parsed.dailyRows.length > 0) {
          mktSheetRes = { parsed, stale: false };
        }
      }
      if (!mktSheetRes) {
        mktSheetRes = readCachedMarketingJson(jsonCachePath);
      }
      if (mktCsv.length > 20 && bookedCsv.length > 20 && arrivedCsv.length > 20 && mktSheetRes) {
        overviewSourcesCache = {
          // Đặt fetchedAt = 0 để lần gọi getAdminOverviewData đầu tiên luôn chủ động đồng bộ dữ liệu mới nhất từ Google Sheet
          fetchedAt: 0,
          mktRes: { csvText: mktCsv, stale: false },
          bookedRes: { csvText: bookedCsv, stale: false },
          arrivedRes: { csvText: arrivedCsv, stale: false },
          mktSheetRes,
        };
      }
    }
  } catch {
    // Ignore disk warm-up errors
  }
}

warmOverviewCacheFromDisk();

async function refreshOverviewSourcesRemote() {
  if (inFlightOverviewPromise) {
    return inFlightOverviewPromise;
  }
  inFlightOverviewPromise = (async () => {
    try {
      const mktUrl = buildCsvExportUrl(SPREADSHEET_ID, SHEETS_CONFIG.mkt.gid);
      const bookedUrl = buildCsvExportUrl(SPREADSHEET_ID, SHEETS_CONFIG.booked.gid);
      const arrivedUrl = buildCsvExportUrl(SPREADSHEET_ID, SHEETS_CONFIG.arrived.gid);

      const [mktRes, bookedRes, arrivedRes, mktSheetRes] = await Promise.all([
        fetchCsvWithCache(mktUrl, 'mkt.csv'),
        fetchCsvWithCache(bookedUrl, 'booked.csv'),
        fetchCsvWithCache(arrivedUrl, 'arrived.csv'),
        fetchMarketingDataWithCache(),
      ]);

      overviewSourcesCache = {
        fetchedAt: Date.now(),
        mktRes,
        bookedRes,
        arrivedRes,
        mktSheetRes,
      };
      return overviewSourcesCache;
    } finally {
      inFlightOverviewPromise = null;
    }
  })();

  return inFlightOverviewPromise;
}

function computeWindowSummary(crmData, mktDailyRows, windowPeriod) {
  const leadsInPeriod = crmData.mkt.filter((r) => inDateWindow(r.dataDateIso, windowPeriod, false));

  // Hoàn thiện lịch hẹn từ các lead xác nhận Đặt hẹn (như completeAppointments trong crm-tram-chua-da)
  const bookedKeys = new Set(
    crmData.booked
      .filter((r) => r.phone && r.apptDateIso)
      .map((r) => `${r.phone}|${r.apptDateIso}`)
  );
  const derivedBookings = [];
  for (const lead of crmData.mkt) {
    if (
      lead.phone &&
      lead.apptDateIso &&
      lead.canonicalStatus === 'ĐẶT HẸN' &&
      !bookedKeys.has(`${lead.phone}|${lead.apptDateIso}`)
    ) {
      bookedKeys.add(`${lead.phone}|${lead.apptDateIso}`);
      derivedBookings.push({ ...lead, derived: true });
    }
  }

  const allBooked = [...crmData.booked, ...derivedBookings];
  const bookedInPeriod = allBooked.filter((r) =>
    inDateWindow(r.apptDateIso || r.dataDateIso, windowPeriod, false)
  );
  const pastAppointments = bookedInPeriod.filter((r) => {
    const d = r.apptDateIso || r.dataDateIso;
    return d && d <= windowPeriod.today;
  });

  const arrivedInPeriod = crmData.arrived.filter((r) =>
    inDateWindow(r.apptDateIso || r.dataDateIso, windowPeriod, true)
  );

  let crmRevenue = 0;
  let revenueCount = 0;
  for (const r of arrivedInPeriod) {
    if (r.revenue !== null && Number.isFinite(r.revenue)) {
      crmRevenue += r.revenue;
      revenueCount++;
    }
  }

  const mktInPeriod = mktDailyRows.filter((r) => inDateWindow(r.dateIso, windowPeriod, true));
  let mktReceived = 0;
  let mktAds = 0;
  let mktFee = 0;
  let mktCost = 0;
  let mktMessages = 0;
  let activeCostDays = 0;

  for (const r of mktInPeriod) {
    mktReceived += r.received || 0;
    mktAds += r.ads || 0;
    mktFee += r.fee || 0;
    mktCost += r.cost || 0;
    mktMessages += r.messages || 0;
    if ((r.cost || 0) > 0 || (r.ads || 0) > 0) {
      activeCostDays++;
    }
  }

  const avgDailyCost = activeCostDays > 0 ? mktCost / activeCostDays : 0;

  const leadsCount = leadsInPeriod.length;
  const arrivedCount = arrivedInPeriod.length;
  const appointmentsCount = bookedInPeriod.length;

  const costPerData = leadsCount > 0 && mktCost > 0 ? mktCost / leadsCount : null;
  const costPerAppointment =
    appointmentsCount > 0 && mktCost > 0 ? mktCost / appointmentsCount : null;
  const costPerArrived = arrivedCount > 0 && mktCost > 0 ? mktCost / arrivedCount : null;
  const costRevenueRatio = crmRevenue > 0 && mktCost > 0 ? (mktCost / crmRevenue) * 100 : null;

  return {
    crm: {
      leads: leadsCount,
      appointments: appointmentsCount,
      pastAppointments: pastAppointments.length,
      derivedAppointments: bookedInPeriod.filter((r) => r.derived).length,
      arrived: arrivedCount,
      revenue: crmRevenue,
      revenueRecordedCount: revenueCount,
      avgOrderValue: revenueCount > 0 ? crmRevenue / revenueCount : 0,
    },
    marketing: {
      received: mktReceived,
      adsCost: mktAds,
      managementFee: mktFee,
      cost: mktCost,
      messages: mktMessages,
      activeCostDays,
      avgDailyCost,
      costRevenueRatio,
      costPerData,
      costPerAppointment,
      costPerArrived,
    },
    records: {
      leadsInPeriod,
      bookedInPeriod,
      arrivedInPeriod,
      allBooked,
    },
  };
}

/**
 * Xây dựng dữ liệu Tổng quan Điều hành (CEO Overview) kết hợp từ repo vanhao1997/crm-tram-chua-da
 */
export async function getAdminOverviewData(query = {}) {
  const period = resolveOverviewPeriod(query);
  const prevPeriod = resolveComparisonPeriod(period);

  const activeTelesales = getActiveTelesaleNames();
  const knownTelesales =
    activeTelesales.length > 0 ? activeTelesales : [...DEFAULT_TELESALE_LIST];

  const forceRefresh = query.refresh === '1' || query.refresh === 'true';
  const hasCachedSources =
    overviewSourcesCache.mktRes &&
    overviewSourcesCache.bookedRes &&
    overviewSourcesCache.arrivedRes &&
    overviewSourcesCache.mktSheetRes;

  const isStale = Date.now() - overviewSourcesCache.fetchedAt >= OVERVIEW_CACHE_TTL_MS;
  if (forceRefresh || !hasCachedSources || (isStale && !process.env.NODE_TEST_CONTEXT)) {
    await refreshOverviewSourcesRemote();
  }

  const { mktRes, bookedRes, arrivedRes, mktSheetRes } = overviewSourcesCache;
  const localSnap = getLocalStateSnapshot();

  function mergeSheetWithLocalState(baseItems, sheetKey) {
    const rowOverrides = localSnap.rowOverrides || {};
    const addedList = localSnap.addedRecords?.[sheetKey] || [];
    const revByPhone = localSnap.revenueByPhone || {};

    const applyOv = (item) => {
      const ov = rowOverrides[`${sheetKey}:${item.sheetRowIndex}`];
      const next = { ...item };
      if (ov) {
        if (ov.status !== undefined) {
          const st = classifyStatus(ov.status);
          next.status = st.status;
          next.canonicalStatus = st.canonicalStatus;
          next.statusLabel = st.statusLabel;
          next.statusGroup = st.statusGroup;
          next.badgeColor = st.badgeColor;
        }
        if (ov.telesale !== undefined) next.telesale = String(ov.telesale || '').trim().toUpperCase();
        if (ov.apptDate !== undefined) {
          next.apptDate = ov.apptDate;
          next.apptDateIso = parseVnDateToIso(ov.apptDate);
        }
        if (ov.apptTime !== undefined) next.apptTime = ov.apptTime;
        if (ov.noteM !== undefined) next.noteM = ov.noteM;
        if (ov.customerInfo !== undefined) next.customerInfo = ov.customerInfo;
        if (ov.revenueAmount !== undefined && ov.revenueAmount !== null) {
          next.revenue = ov.revenueAmount;
        }
      }
      if (
        (next.revenue === null || next.revenue === undefined) &&
        next.phone &&
        revByPhone[next.phone] !== undefined
      ) {
        next.revenue = revByPhone[next.phone];
      }
      return next;
    };

    const withOv = baseItems
      .filter((r) => !isRecordDeletedInLocalState(sheetKey, r, localSnap))
      .map(applyOv);
    const existingPhones = new Set(withOv.map((r) => r.phone).filter(Boolean));
    const uniqueAdded = addedList
      .filter((r) => !isRecordDeletedInLocalState(sheetKey, r, localSnap))
      .filter((r) => !r.phone || !existingPhones.has(r.phone))
      .map((rec) => {
        const rev =
          rec.revenueAmount !== undefined && rec.revenueAmount !== null
            ? rec.revenueAmount
            : rec.phone && revByPhone[rec.phone] !== undefined
            ? revByPhone[rec.phone]
            : null;
        return applyOv({
          ...rec,
          serviceGroup: classifyServiceGroup(rec.service),
          revenue: rev,
        });
      });

    return [...withOv, ...uniqueAdded];
  }

  const crmData = {
    mkt: mergeSheetWithLocalState(parseAdminCrmRows(mktRes.csvText, 'mkt', knownTelesales), 'mkt'),
    booked: mergeSheetWithLocalState(
      parseAdminCrmRows(bookedRes.csvText, 'booked', knownTelesales),
      'booked'
    ),
    arrived: mergeSheetWithLocalState(
      parseAdminCrmRows(arrivedRes.csvText, 'arrived', knownTelesales),
      'arrived'
    ),
  };

  const parsedMkt = mktSheetRes.parsed;

  const current = computeWindowSummary(crmData, parsedMkt.dailyRows, period);
  const baseline = prevPeriod
    ? computeWindowSummary(crmData, parsedMkt.dailyRows, prevPeriod)
    : null;

  // Tính Số dư còn lại (Balance = Tổng nhận - Tổng chi phí, có thể âm) theo kỳ đang chọn
  const balance = current.marketing.received - current.marketing.cost;
  const topUpNeeded = balance < 0 ? Math.abs(Math.round(balance)) : 0;
  const avgDailyCost = current.marketing.avgDailyCost || 0;
  const estimatedDaysLeft =
    balance > 0 && avgDailyCost > 0
      ? Number((balance / avgDailyCost).toFixed(1))
      : balance <= 0
      ? 0
      : null;
  const recommendedTopUp7Days =
    balance < 0
      ? Math.abs(Math.round(balance)) + (avgDailyCost > 0 ? Math.round(avgDailyCost * 7) : 0)
      : avgDailyCost > 0 && balance < avgDailyCost * 7
      ? Math.round(avgDailyCost * 7 - balance)
      : 0;

  // Tính Số dư lũy kế của Tháng hiện tại trên Sheet 2026 (để khi lọc Hôm nay / Tuần này vẫn thấy rõ quỹ tháng)
  const todayMonthKey = (period.today || '').slice(0, 7);
  const monthRows = parsedMkt.dailyRows.filter((r) => r.dateIso.startsWith(todayMonthKey));
  const currentMonthReceived = monthRows.reduce((acc, r) => acc + (r.received || 0), 0);
  const currentMonthCost = monthRows.reduce((acc, r) => acc + (r.cost || 0), 0);
  const monthSummaryObj = parsedMkt.monthlySummaries?.[todayMonthKey] || null;
  const currentMonthBalance =
    monthSummaryObj?.balance !== undefined && monthSummaryObj?.balance !== null
      ? monthSummaryObj.balance
      : currentMonthReceived - currentMonthCost;
  const currentMonthLabel =
    monthSummaryObj?.label ||
    (todayMonthKey ? `Tháng ${Number(todayMonthKey.slice(5, 7))}` : 'Tháng này');

  // So sánh kỳ trước cho Giá 1 Data & Giá 1 Khách đến
  function buildComparison(currentVal, baselineVal) {
    if (currentVal === null || baselineVal === null || baselineVal <= 0) {
      return { deltaPct: null, baseline: baselineVal };
    }
    const deltaPct = ((currentVal - baselineVal) / baselineVal) * 100;
    return {
      deltaPct: Number(deltaPct.toFixed(1)),
      baseline: Math.round(baselineVal),
    };
  }

  // 1. Phễu chuyển đổi theo 3 nhóm Dịch vụ (Nâng cơ, Mũi chỉ/Mũi sợi, Khác)
  const serviceMeta = [
    { key: 'nangco', label: 'Trẻ Hóa Nâng Cơ' },
    { key: 'muichi', label: 'Mũi Chỉ / Mũi Sợi' },
    { key: 'khac', label: 'Dịch Vụ Khác' },
  ];
  const serviceFunnel = serviceMeta.map((svc) => {
    const leads = current.records.leadsInPeriod.filter((r) => r.serviceGroup === svc.key).length;
    const booked = current.records.bookedInPeriod.filter((r) => r.serviceGroup === svc.key).length;
    const arrivedList = current.records.arrivedInPeriod.filter((r) => r.serviceGroup === svc.key);
    const arrived = arrivedList.length;
    const revenue = arrivedList.reduce((sum, r) => sum + (r.revenue || 0), 0);
    return {
      key: svc.key,
      label: svc.label,
      leads,
      booked,
      arrived,
      bookingRate: leads > 0 ? Number(((booked / leads) * 100).toFixed(1)) : 0,
      arrivalRate: booked > 0 ? Number(((arrived / booked) * 100).toFixed(1)) : 0,
      revenue,
    };
  });

  // 2. Bảng xếp hạng Hiệu suất & Doanh số theo Nhân sự Telesale
  const staffMap = new Map();
  for (const name of knownTelesales) {
    staffMap.set(name, {
      telesale: name,
      leads: 0,
      booked: 0,
      arrived: 0,
      revenue: 0,
    });
  }

  for (const r of current.records.leadsInPeriod) {
    const key = r.telesale || 'CHƯA PHÂN BỔ';
    if (!staffMap.has(key)) {
      staffMap.set(key, { telesale: key, leads: 0, booked: 0, arrived: 0, revenue: 0 });
    }
    staffMap.get(key).leads++;
  }
  for (const r of current.records.bookedInPeriod) {
    const key = r.telesale || 'CHƯA PHÂN BỔ';
    if (!staffMap.has(key)) {
      staffMap.set(key, { telesale: key, leads: 0, booked: 0, arrived: 0, revenue: 0 });
    }
    staffMap.get(key).booked++;
  }
  for (const r of current.records.arrivedInPeriod) {
    const key = r.telesale || 'CHƯA PHÂN BỔ';
    if (!staffMap.has(key)) {
      staffMap.set(key, { telesale: key, leads: 0, booked: 0, arrived: 0, revenue: 0 });
    }
    const entry = staffMap.get(key);
    entry.arrived++;
    entry.revenue += r.revenue || 0;
  }

  const telesaleLeaderboard = Array.from(staffMap.values())
    .map((item) => ({
      ...item,
      bookingRate: item.leads > 0 ? Number(((item.booked / item.leads) * 100).toFixed(1)) : 0,
      arrivalRate: item.booked > 0 ? Number(((item.arrived / item.booked) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.arrived - a.arrived || b.booked - a.booked);

  // 3. Lịch hẹn sắp tới & Lịch hẹn 7 ngày qua (như appointment-summary.js trong crm-tram-chua-da)
  const sevenDaysAgo = shiftDay(period.today, -6);
  const arrivedEventKeys = new Set(
    crmData.arrived
      .filter((r) => r.phone && (r.apptDateIso || r.dataDateIso))
      .map((r) => `${r.phone}|${r.apptDateIso || r.dataDateIso}`)
  );

  const upcomingAppointments = current.records.allBooked
    .filter((r) => r.apptDateIso && r.apptDateIso >= period.today)
    .sort((a, b) => a.apptDateIso.localeCompare(b.apptDateIso))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      name: r.name,
      service: r.service || 'Chưa rõ dịch vụ',
      apptDate: r.apptDate,
      apptDateIso: r.apptDateIso,
      apptTime: r.apptTime || 'Chưa rõ giờ',
      telesale: r.telesale || 'Chưa gán',
      statusLabel: r.statusLabel,
      derived: Boolean(r.derived),
    }));

  const recentPastAppointments = current.records.allBooked
    .filter((r) => r.apptDateIso && r.apptDateIso >= sevenDaysAgo && r.apptDateIso <= period.today)
    .sort((a, b) => b.apptDateIso.localeCompare(a.apptDateIso))
    .slice(0, 20)
    .map((r) => {
      const visited = arrivedEventKeys.has(`${r.phone}|${r.apptDateIso}`);
      return {
        id: r.id,
        name: r.name,
        service: r.service || 'Chưa rõ dịch vụ',
        apptDate: r.apptDate,
        apptDateIso: r.apptDateIso,
        apptTime: r.apptTime || 'Chưa rõ giờ',
        telesale: r.telesale || 'Chưa gán',
        statusLabel: visited ? 'Đã đến cơ sở' : r.statusLabel,
        visited,
      };
    });

  // 4. Kiểm tra Toàn vẹn & Đối soát Dữ liệu (integrity.js từ crm-tram-chua-da)
  const integrityIssues = [];

  for (const r of current.records.arrivedInPeriod) {
    if (r.revenue === null) {
      integrityIssues.push({
        code: 'CRM_REVENUE_MISSING',
        severity: 'critical',
        dateKey: r.apptDateIso || r.dataDateIso || '',
        row: r.sheetRowIndex,
        customerName: r.name,
        message: `Khách đến "${r.name}" (${r.apptDate || r.dataDate}) chưa có doanh số được ghi nhận ở Cột W.`,
      });
    }
  }

  const bookedPhonesSet = new Set(crmData.booked.map((r) => r.phone).filter(Boolean));
  for (const r of current.records.leadsInPeriod) {
    if (r.statusGroup === 'booked' && r.phone && !bookedPhonesSet.has(r.phone)) {
      integrityIssues.push({
        code: 'APPOINTMENT_MISSING',
        severity: 'warning',
        dateKey: r.dataDateIso || '',
        row: r.sheetRowIndex,
        customerName: r.name,
        message: `Khách "${r.name}" đã chốt Đặt Hẹn ở Tab 1 nhưng chưa sang Tab 2 (Khách Đặt Hẹn).`,
      });
    }
  }

  for (const mRow of parsedMkt.dailyRows) {
    if (!inDateWindow(mRow.dateIso, period, true)) continue;
    if (
      mRow.rawAds !== null &&
      mRow.rawFee !== null &&
      mRow.rawCost !== null &&
      Math.abs(mRow.rawAds + mRow.rawFee - mRow.rawCost) > 10
    ) {
      integrityIssues.push({
        code: 'COST_MISMATCH',
        severity: 'critical',
        dateKey: mRow.dateIso,
        row: mRow.rowIndex,
        message: `Ngày ${mRow.dateText}: Chi phí Ads + Phí quản lý không khớp Tổng chi phí trên Sheet Marketing.`,
      });
    }
  }

  for (const fErr of parsedMkt.formulaErrors) {
    integrityIssues.push({
      code: 'SOURCE_FORMULA_ERROR',
      severity: 'critical',
      dateKey: fErr.dateKey,
      row: fErr.row,
      message: `Sheet Marketing dòng ${fErr.row} (${fErr.dateKey}) có lỗi công thức (#REF!, #VALUE!...).`,
    });
  }

  // 5. Đề xuất Ngân sách (Budget Decision Center từ budget-intelligence.js)
  const ratio = current.marketing.costRevenueRatio;
  let budgetRecommendation = {
    action: 'hold',
    label: 'Giữ nguyên ngân sách',
    reason: 'Tỷ lệ Chi phí / Doanh thu đang ở ngưỡng ổn định.',
  };
  if (ratio === null || current.crm.leads < 5) {
    budgetRecommendation = {
      action: 'insufficient_data',
      label: 'Chưa đủ dữ liệu kỳ này',
      reason: 'Cần thêm dữ liệu phát sinh trong kỳ để đánh giá hiệu quả ngân sách.',
    };
  } else if (ratio <= 25) {
    budgetRecommendation = {
      action: 'increase',
      label: 'Đề xuất: Tăng 10% ngân sách Ads',
      reason: `Tỷ lệ Chi phí/Doanh thu rất tốt (${ratio.toFixed(1)}% <= 25%), hiệu suất chuyển đổi cao.`,
    };
  } else if (ratio >= 40) {
    budgetRecommendation = {
      action: 'decrease',
      label: 'Cảnh báo: Tối ưu / Giảm 10% ngân sách',
      reason: `Tỷ lệ Chi phí/Doanh thu cao (${ratio.toFixed(1)}% >= 40%), cần rà soát chất lượng lead & tỷ lệ chốt hẹn.`,
    };
  }

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    stale: mktRes.stale || bookedRes.stale || arrivedRes.stale || mktSheetRes.stale,
    period,
    comparisonPeriod: prevPeriod,
    crm: current.crm,
    marketing: {
      ...current.marketing,
      balance,
      topUpNeeded,
      estimatedDaysLeft,
      recommendedTopUp7Days,
      currentMonthBalance,
      currentMonthReceived,
      currentMonthCost,
      currentMonthLabel,
      costPerDataComparison: buildComparison(
        current.marketing.costPerData,
        baseline?.marketing?.costPerData ?? null
      ),
      costPerArrivedComparison: buildComparison(
        current.marketing.costPerArrived,
        baseline?.marketing?.costPerArrived ?? null
      ),
      budgetRecommendation,
    },
    serviceFunnel,
    telesaleLeaderboard,
    arrivedCustomers: current.records.arrivedInPeriod.map((r) => ({
      id: r.id,
      row: r.sheetRowIndex,
      dataDate: r.dataDate,
      apptDate: r.apptDate || r.dataDate,
      name: r.name,
      phoneDisplay: r.phoneDisplay,
      service: r.service,
      telesale: r.telesale || 'Chưa gán',
      statusLabel: r.statusLabel,
      noteM: r.noteM,
      revenue: r.revenue,
    })),
    appointments: {
      upcomingCount: upcomingAppointments.length,
      recentPastCount: recentPastAppointments.length,
      upcoming: upcomingAppointments,
      recentPast: recentPastAppointments,
    },
    integrity: {
      ok: !integrityIssues.some((i) => i.severity === 'critical'),
      totalIssues: integrityIssues.length,
      criticalCount: integrityIssues.filter((i) => i.severity === 'critical').length,
      warningCount: integrityIssues.filter((i) => i.severity === 'warning').length,
      issues: integrityIssues.slice(0, 30),
    },
  };
}
