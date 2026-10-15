import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_DIR,
  SPREADSHEET_ID,
  SHEETS_CONFIG,
  DEFAULT_TELESALE_LIST,
  STATUS_OPTIONS,
  QUICK_NOTE_TEMPLATES,
  buildCsvExportUrl,
} from './config.js';
import {
  parseSheetRecords,
  classifyStatus,
  normalizePhone,
  formatPhoneDisplay,
  parseVnDateToIso,
} from './sheets-parser.js';
import { getActiveTelesaleNames } from './auth.js';

const DATA_DIR = path.join(ROOT_DIR, 'server', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const STATE_FILE = path.join(DATA_DIR, 'local-state.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadLocalState() {
  ensureDirs();
  const defaultState = {
    telesaleList: [...DEFAULT_TELESALE_LIST],
    appsScriptUrl: process.env.GOOGLE_APPS_SCRIPT_URL || '',
    autoSyncSheets: true,
    rowOverrides: {},
    addedRecords: {
      mkt: [],
      booked: [],
      arrived: [],
    },
  };

  if (!fs.existsSync(STATE_FILE)) {
    return defaultState;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const list =
      Array.isArray(raw.telesaleList) && raw.telesaleList.length > 0
        ? raw.telesaleList
            .map((s) => String(s || '').trim().toUpperCase())
            .filter(Boolean)
            .slice(0, 5)
        : [...DEFAULT_TELESALE_LIST];
    while (list.length < 5) {
      list.push(`TELESALE ${list.length + 1}`);
    }
    return {
      ...defaultState,
      ...raw,
      telesaleList: list,
      appsScriptUrl: raw.appsScriptUrl || process.env.GOOGLE_APPS_SCRIPT_URL || '',
      rowOverrides: raw.rowOverrides || {},
      addedRecords: {
        mkt: raw.addedRecords?.mkt || [],
        booked: raw.addedRecords?.booked || [],
        arrived: raw.addedRecords?.arrived || [],
      },
    };
  } catch {
    return defaultState;
  }
}

let stateVersion = 1;
let cachedResponseEntry = {
  key: '',
  payload: null,
};

function saveLocalState(state) {
  stateVersion++;
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

let localState = loadLocalState();
let memoryCache = {
  fetchedAt: 0,
  sheets: null,
};
const CACHE_TTL_MS = 45 * 1000;
let inFlightRefreshPromise = null;

function warmCacheFromDisk() {
  try {
    ensureDirs();
    const mktPath = path.join(CACHE_DIR, 'mkt.csv');
    const bookedPath = path.join(CACHE_DIR, 'booked.csv');
    const arrivedPath = path.join(CACHE_DIR, 'arrived.csv');
    if (
      fs.existsSync(mktPath) &&
      fs.existsSync(bookedPath) &&
      fs.existsSync(arrivedPath)
    ) {
      const mktCsv = fs.readFileSync(mktPath, 'utf8');
      const bookedCsv = fs.readFileSync(bookedPath, 'utf8');
      const arrivedCsv = fs.readFileSync(arrivedPath, 'utf8');
      if (mktCsv.length > 20 && bookedCsv.length > 20 && arrivedCsv.length > 20) {
        const mtime = Math.min(
          fs.statSync(mktPath).mtimeMs,
          fs.statSync(bookedPath).mtimeMs,
          fs.statSync(arrivedPath).mtimeMs
        );
        memoryCache = {
          fetchedAt: mtime || Date.now() - CACHE_TTL_MS,
          sheets: {
            mkt: parseSheetRecords(mktCsv, 'mkt', localState.telesaleList),
            booked: parseSheetRecords(bookedCsv, 'booked', localState.telesaleList),
            arrived: parseSheetRecords(arrivedCsv, 'arrived', localState.telesaleList),
          },
        };
        stateVersion++;
      }
    }
  } catch {
    // Ignore warm-up errors and fall back to network fetch
  }
}

warmCacheFromDisk();

async function fetchSheetCsv(sheetKey) {
  ensureDirs();
  const cfg = SHEETS_CONFIG[sheetKey];
  if (!cfg) throw new Error(`Sheet key không hợp lệ: ${sheetKey}`);

  const cacheFile = path.join(CACHE_DIR, `${sheetKey}.csv`);
  const url = buildCsvExportUrl(SPREADSHEET_ID, cfg.gid);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    timer.unref?.();
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CRM-BSN-Telesale/1.0',
        Accept: 'text/csv,text/plain,*/*',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const csvText = await res.text();
    if (csvText && csvText.length > 20 && !csvText.trim().startsWith('<!DOCTYPE html')) {
      fs.writeFileSync(cacheFile, csvText, 'utf8');
      return { csvText };
    }
    throw new Error('Nội dung CSV không hợp lệ');
  } catch (err) {
    if (fs.existsSync(cacheFile)) {
      const cached = fs.readFileSync(cacheFile, 'utf8');
      return { csvText: cached };
    }
    throw err;
  }
}

function applyOverrideToRecord(record, override) {
  if (!override) return record;
  const updated = { ...record };

  if (override.customerInfo !== undefined) updated.customerInfo = override.customerInfo;
  if (override.apptTime !== undefined) updated.apptTime = override.apptTime;
  if (override.apptDate !== undefined) {
    updated.apptDate = override.apptDate;
    updated.apptDateIso = parseVnDateToIso(override.apptDate) || override.apptDate;
  }
  if (override.telesale !== undefined) {
    updated.telesale = String(override.telesale || '').trim().toUpperCase();
  }
  if (override.noteM !== undefined) {
    updated.noteM = override.noteM;
  }
  if (override.status !== undefined) {
    const statusInfo = classifyStatus(override.status);
    updated.status = statusInfo.status;
    updated.canonicalStatus = statusInfo.canonicalStatus;
    updated.statusLabel = statusInfo.statusLabel;
    updated.statusGroup = statusInfo.statusGroup;
    updated.badgeColor = statusInfo.badgeColor;
  }
  if (Array.isArray(override.careHistory)) {
    updated.careHistory = override.careHistory
      .map((item) => ({
        text: String(item?.text ?? item ?? '').trim(),
        addedAt: item?.addedAt || '',
      }))
      .filter((item) => Boolean(item.text));
  }
  if (Array.isArray(override.careAdditions) && override.careAdditions.length > 0) {
    const baseHistory = Array.isArray(updated.careHistory) ? [...updated.careHistory] : [];
    for (const item of override.careAdditions) {
      const txt = String(item?.text ?? item ?? '').trim();
      if (!txt) continue;
      baseHistory.push({
        text: txt,
        addedAt: item.addedAt || '',
      });
    }
    updated.careHistory = baseHistory;
  }

  return updated;
}

async function refreshSheetsFromRemote() {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }
  inFlightRefreshPromise = (async () => {
    try {
      const [mktRes, bookedRes, arrivedRes] = await Promise.all([
        fetchSheetCsv('mkt'),
        fetchSheetCsv('booked'),
        fetchSheetCsv('arrived'),
      ]);

      const now = Date.now();
      const parsedSheets = {
        mkt: parseSheetRecords(mktRes.csvText, 'mkt', localState.telesaleList),
        booked: parseSheetRecords(bookedRes.csvText, 'booked', localState.telesaleList),
        arrived: parseSheetRecords(arrivedRes.csvText, 'arrived', localState.telesaleList),
      };

      memoryCache = {
        fetchedAt: now,
        sheets: parsedSheets,
      };
      stateVersion++;
      return memoryCache;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

export async function getAllSheetsData(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && memoryCache.sheets) {
    const isStale = now - memoryCache.fetchedAt >= CACHE_TTL_MS;
    if (isStale && !process.env.NODE_TEST_CONTEXT) {
      refreshSheetsFromRemote().catch(() => {});
    }
    return buildFullResponse(memoryCache.sheets, memoryCache.fetchedAt);
  }

  await refreshSheetsFromRemote();
  return buildFullResponse(memoryCache.sheets, memoryCache.fetchedAt);
}

function sanitizeDataDeep(obj, spreadsheetId) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    let s = obj.normalize('NFC');
    if (s.includes('docs.google.com')) s = s.replace(/https?:\/\/docs\.google\.com\S*/gi, '');
    if (spreadsheetId && s.includes(spreadsheetId)) s = s.replaceAll(spreadsheetId, '');
    if (s.includes('₫')) s = s.replaceAll('₫', '');
    return s;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeDataDeep(item, spreadsheetId));
  }
  if (typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      const lowerKey = k.toLowerCase();
      if (
        lowerKey === 'revenue' ||
        lowerKey === 'revenueamount' ||
        lowerKey === 'fblink' ||
        lowerKey === 'spreadsheetid' ||
        lowerKey === 'spreadsheeturl' ||
        lowerKey === 'sheeturl'
      ) {
        continue;
      }
      res[k] = sanitizeDataDeep(v, spreadsheetId);
    }
    return res;
  }
  return obj;
}

/**
 * Xây dựng dữ liệu trả về cho Frontend:
 * Tuyệt đối KHÔNG trả về spreadsheetId, spreadsheetUrl, sheetUrl, hay doanh số (revenue).
 * Có cơ chế memoization theo stateVersion để tránh lặp lại việc duyệt/sanitize hàng nghìn dòng.
 */
function buildFullResponse(parsedSheets, fetchedAt) {
  const activeTelesales = getActiveTelesaleNames();
  const telesaleList = activeTelesales.length > 0 ? activeTelesales : localState.telesaleList;
  const cacheKey = `${stateVersion}:${fetchedAt}:${telesaleList.join(',')}`;

  if (cachedResponseEntry.key === cacheKey && cachedResponseEntry.payload) {
    return cachedResponseEntry.payload;
  }

  const mergedSheets = {};

  for (const sheetKey of ['mkt', 'booked', 'arrived']) {
    const baseRecords = parsedSheets[sheetKey]?.records || [];
    const withOverrides = baseRecords.map((rec) => {
      const key = `${sheetKey}:${rec.sheetRowIndex}`;
      return applyOverrideToRecord(rec, localState.rowOverrides[key]);
    });

    const added = (localState.addedRecords[sheetKey] || []).map((rec) => {
      const key = `${sheetKey}:${rec.sheetRowIndex}`;
      return applyOverrideToRecord(rec, localState.rowOverrides[key]);
    });

    const existingPhones = new Set(withOverrides.map((r) => r.phone).filter(Boolean));
    const uniqueAdded = added.filter((r) => !r.phone || !existingPhones.has(r.phone));

    const allRecords = [...withOverrides, ...uniqueAdded]
      .sort((a, b) => b.sheetRowIndex - a.sheetRowIndex)
      .map((rec) => {
        const clean = { ...rec };
        delete clean.revenue;
        delete clean.revenueAmount;
        delete clean.fbLink;
        delete clean.spreadsheetId;
        delete clean.spreadsheetUrl;
        return clean;
      });

    mergedSheets[sheetKey] = {
      key: sheetKey,
      name: SHEETS_CONFIG[sheetKey].name,
      shortName: SHEETS_CONFIG[sheetKey].shortName,
      records: allRecords,
    };
  }

  const rawPayload = {
    ok: true,
    fetchedAt: new Date(fetchedAt).toISOString(),
    telesaleList,
    statusOptions: STATUS_OPTIONS,
    quickNoteTemplates: QUICK_NOTE_TEMPLATES,
    sheets: mergedSheets,
  };

  const sanitized = sanitizeDataDeep(rawPayload, SPREADSHEET_ID);
  cachedResponseEntry = {
    key: cacheKey,
    payload: sanitized,
  };
  return sanitized;
}

async function postToAppsScript(payload) {
  const url = localState.appsScriptUrl;
  if (!url) {
    return { synced: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    timer.unref?.();
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    clearTimeout(timer);
    const data = await res.json();
    return { synced: Boolean(data?.ok) };
  } catch {
    return { synced: false };
  }
}

export async function updateCustomerInteraction({
  sheetKey = 'mkt',
  sheetRowIndex,
  phone,
  name,
  updates = {},
  appendCareNoteText = '',
}) {
  if (!SHEETS_CONFIG[sheetKey]) {
    throw new Error(`Sheet không hợp lệ: ${sheetKey}`);
  }
  const rowIdx = Number(sheetRowIndex);
  if (!rowIdx || rowIdx < 2) {
    throw new Error('Số dòng không hợp lệ');
  }

  const overrideKey = `${sheetKey}:${rowIdx}`;
  const existingOverride = localState.rowOverrides[overrideKey] || {};
  const nowIso = new Date().toISOString();

  const nextOverride = {
    ...existingOverride,
    updatedAt: nowIso,
  };

  if (updates.status !== undefined) nextOverride.status = String(updates.status).trim();
  if (updates.telesale !== undefined) {
    nextOverride.telesale = String(updates.telesale).trim().toUpperCase();
  }
  if (updates.noteM !== undefined) nextOverride.noteM = String(updates.noteM).trim();
  if (updates.customerInfo !== undefined) {
    nextOverride.customerInfo = String(updates.customerInfo).trim();
  }
  if (updates.apptTime !== undefined) nextOverride.apptTime = String(updates.apptTime).trim();
  if (updates.apptDate !== undefined) nextOverride.apptDate = String(updates.apptDate).trim();

  if (Array.isArray(updates.careHistory)) {
    nextOverride.careHistory = updates.careHistory
      .map((item) => ({
        text: String(item?.text ?? item ?? '').trim(),
        addedAt: item?.addedAt || nowIso,
      }))
      .filter((item) => Boolean(item.text));
    delete nextOverride.careAdditions;
  }

  const cleanCareAppend = String(appendCareNoteText || '').trim();
  if (cleanCareAppend) {
    const newCareEntry = {
      text: cleanCareAppend,
      addedAt: nowIso,
    };
    if (Array.isArray(nextOverride.careHistory)) {
      nextOverride.careHistory = [...nextOverride.careHistory, newCareEntry];
    } else {
      const careList = Array.isArray(nextOverride.careAdditions)
        ? [...nextOverride.careAdditions]
        : [];
      careList.push(newCareEntry);
      nextOverride.careAdditions = careList;
    }
  }

  localState.rowOverrides[overrideKey] = nextOverride;

  if (localState.autoSyncSheets) {
    const currentRec = findRecordInSheet(sheetKey, rowIdx);
    const effectiveStatus =
      updates.status !== undefined ? updates.status : currentRec?.status || '';
    const statusInfo = classifyStatus(effectiveStatus);
    const hasApptDate = Boolean((updates.apptDate ?? currentRec?.apptDate ?? '').trim());

    if (sheetKey === 'mkt' && (statusInfo.statusGroup === 'booked' || hasApptDate)) {
      const targetStatus =
        statusInfo.canonicalStatus === 'DỜI LỊCH' ? 'DỜI LỊCH' : 'ĐẶT HẸN';
      syncRecordLocallyToTargetSheet('mkt', rowIdx, 'booked', targetStatus);
    }
    if (sheetKey !== 'arrived' && statusInfo.statusGroup === 'arrived') {
      syncRecordLocallyToTargetSheet(sheetKey, rowIdx, 'arrived', 'ĐÃ ĐẾN');
    }
  }

  saveLocalState(localState);

  // Đồng bộ ngầm (non-blocking) sang Google Apps Script để phản hồi UI tức thì (< 10ms)
  if (localState.appsScriptUrl && !process.env.NODE_TEST_CONTEXT) {
    void (async () => {
      await postToAppsScript({
        action: 'updateInteraction',
        sheetKey,
        sheetName: SHEETS_CONFIG[sheetKey].name,
        sheetRowIndex: rowIdx,
        phone,
        name,
        updates,
        autoSyncSheets: localState.autoSyncSheets,
      });

      if (cleanCareAppend) {
        await postToAppsScript({
          action: 'appendCareNote',
          sheetKey,
          sheetName: SHEETS_CONFIG[sheetKey].name,
          sheetRowIndex: rowIdx,
          phone,
          name,
          note: cleanCareAppend,
        });
      }
    })();
  }

  return {
    ok: true,
    overrideKey,
  };
}

function escapeTelegramHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getVnDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const dd = map.day || '01';
  const mm = map.month || '01';
  const yyyy = map.year || '2026';
  const hour = Number(map.hour ?? 0) % 24;
  const minute = Number(map.minute ?? 0);
  return {
    dateVn: `${dd}/${mm}/${yyyy}`,
    dateIso: `${yyyy}-${mm}-${dd}`,
    hour,
    minute,
  };
}

function formatCustomerTelegramItemLines(item, indexNumber = null) {
  const esc = escapeTelegramHtml;
  const prefix = indexNumber !== null ? `${indexNumber}. ` : '';
  const timeText = item.apptTime || 'Chưa báo giờ';
  const nameText = item.name || 'Khách chưa rõ tên';
  const phoneText = item.phone || item.phoneDisplay || '—';
  const serviceText = item.service || '—';
  const statusText = String(item.status || item.statusLabel || 'ĐẶT HẸN').trim().toUpperCase();
  const needCall = item.statusGroup !== 'arrived' && item.statusGroup !== 'lost';
  const statusBadge = needCall
    ? `${esc(statusText)} 🔴 <i>(Cần gọi nhắc)</i>`
    : `${esc(statusText)} 🟢`;
  const telesaleText = item.telesale || 'Chưa phân bổ';
  const custInfoText = item.customerInfo || '—';

  const careTexts = Array.isArray(item.careHistory)
    ? item.careHistory.map((c) => String(c?.text || c || '').trim()).filter(Boolean)
    : [];
  const allNotes = [String(item.noteM || '').trim(), ...careTexts].filter(Boolean).join(' | ');

  return [
    `${prefix}⏰ <b>${esc(timeText)}</b> — <b>${esc(nameText)}</b>`,
    `   📞 SĐT: <code>${esc(phoneText)}</code>`,
    `   💆 Dịch vụ: ${esc(serviceText)}`,
    `   📌 Tình trạng: <b>${statusBadge}</b>`,
    `   👩‍💼 Telesale: <b>${esc(telesaleText)}</b>`,
    `   ℹ️ TT Khách: ${esc(custInfoText)}`,
    `   📝 Ghi chú: <i>${esc(allNotes || '—')}</i>`,
  ];
}

export function formatBatchAppointmentsTelegramMessage(appts, targetDateVn, label = 'HÔM NAY') {
  const esc = escapeTelegramHtml;
  const needCallCount = appts.filter(
    (r) => r.statusGroup !== 'arrived' && r.statusGroup !== 'lost'
  ).length;

  const lines = [
    `📅 <b>LỊCH HẸN KHÁCH HÀNG — ${esc(label)} (${esc(targetDateVn)})</b>`,
    `<b>Trạm Chữa Da BSN</b> • Tổng: <b>${appts.length} khách</b> (${needCallCount} khách cần gọi nhắc)`,
    '━━━━━━━━━━━━━━━━━━━━',
  ];

  if (appts.length === 0) {
    lines.push(`Hiện chưa có khách hàng nào có lịch hẹn vào ngày ${esc(targetDateVn)}.`);
  } else {
    appts.forEach((item, idx) => {
      lines.push(...formatCustomerTelegramItemLines(item, idx + 1));
      if (idx < appts.length - 1) {
        lines.push('');
      }
    });
  }

  return lines.join('\n');
}

export function formatSingleCustomerTelegramMessage(rec) {
  const esc = escapeTelegramHtml;
  const apptDateText = rec.apptDate || rec.dataDate || getVnDateParts().dateVn;
  const lines = [
    `📅 <b>LỊCH HẸN KHÁCH HÀNG — (${esc(apptDateText)})</b>`,
    `<b>Trạm Chữa Da BSN</b> • Thông tin khách lẻ`,
    '━━━━━━━━━━━━━━━━━━━━',
    ...formatCustomerTelegramItemLines(rec, 1),
  ];
  return lines.join('\n');
}

async function dispatchTelegramHtmlText(htmlText, fallbackAppsScriptPayload = null) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();

  if (botToken && chatId) {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const tgJson = await tgRes.json();
    if (!tgJson.ok) {
      throw new Error(tgJson.description || 'Không gửi được tin nhắn Telegram');
    }
    return { via: 'telegram_api' };
  }

  if (localState.appsScriptUrl && fallbackAppsScriptPayload) {
    const gasRes = await postToAppsScript(fallbackAppsScriptPayload);
    if (gasRes.synced) {
      return { via: 'apps_script' };
    }
  }

  throw new Error(
    'Chưa cấu hình TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID trong Coolify / .env (hoặc trong Google Apps Script)'
  );
}

export async function sendSingleCustomerTelegram(payload = {}) {
  const allData = await getAllSheetsData(false);
  const recordId = String(payload.recordId || payload.id || '').trim();
  const sheetKey = String(payload.sheetKey || '').trim();
  const sheetRowIndex = Number(payload.sheetRowIndex || 0);

  let targetRec = null;
  for (const key of ['mkt', 'booked', 'arrived']) {
    const list = allData?.sheets?.[key]?.records || [];
    const found = list.find(
      (r) =>
        (recordId && r.id === recordId) ||
        (sheetKey === key && sheetRowIndex > 0 && r.sheetRowIndex === sheetRowIndex)
    );
    if (found) {
      targetRec = found;
      break;
    }
  }

  if (!targetRec) {
    throw new Error('Không tìm thấy thông tin khách hàng cần gửi Telegram');
  }

  const htmlText = formatSingleCustomerTelegramMessage(targetRec);
  const res = await dispatchTelegramHtmlText(htmlText, {
    action: 'sendSingleTelegram',
    record: targetRec,
    textHtml: htmlText,
  });

  return {
    ok: true,
    mode: 'single',
    customerName: targetRec.name,
    dateVn: targetRec.apptDate || targetRec.dataDate || '',
    via: res.via,
  };
}

export async function sendTelegramReminder(rawInput = {}) {
  const payload =
    typeof rawInput === 'string' ? { range: rawInput } : rawInput && typeof rawInput === 'object' ? rawInput : {};

  if (payload.recordId || payload.mode === 'single') {
    return sendSingleCustomerTelegram(payload);
  }

  const allData = await getAllSheetsData(false);
  const vnToday = getVnDateParts(new Date());
  const vnTomorrow = getVnDateParts(new Date(Date.now() + 24 * 60 * 60 * 1000));

  let targetDateVn = String(payload.dateVn || '').trim();
  let label = String(payload.label || '').trim();

  if (payload.range === 'tomorrow') {
    targetDateVn = targetDateVn || vnTomorrow.dateVn;
    label = label || 'NGÀY MAI';
  } else {
    targetDateVn = targetDateVn || vnToday.dateVn;
    label = label || 'HÔM NAY';
  }

  const targetIso = parseVnDateToIso(targetDateVn);

  const booked = allData?.sheets?.booked?.records || [];
  const mkt = allData?.sheets?.mkt?.records || [];
  const appts = [];
  const seen = new Set();

  for (const r of [...booked, ...mkt]) {
    const rIso = parseVnDateToIso(r.apptDate);
    if (!rIso || rIso !== targetIso) continue;
    const key = `${r.phone || r.name || r.id}:${rIso}`;
    if (seen.has(key)) continue;
    seen.add(key);
    appts.push(r);
  }

  const htmlText = formatBatchAppointmentsTelegramMessage(appts, targetDateVn, label);
  const res = await dispatchTelegramHtmlText(htmlText, {
    action: 'sendTelegramReminder',
    dateVn: targetDateVn,
    label,
    textHtml: htmlText,
  });

  return { ok: true, count: appts.length, dateVn: targetDateVn, via: res.via };
}

let dailySchedulerTimer = null;

export function startDailyTelegramScheduler() {
  if (dailySchedulerTimer) return dailySchedulerTimer;

  const checkAndTrigger8Am = async () => {
    try {
      const hasConfig =
        (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) ||
        Boolean(localState.appsScriptUrl);
      if (!hasConfig) return;

      const vnNow = getVnDateParts(new Date());
      // Tự động gửi vào khung 08:00 - 08:15 sáng mỗi ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh)
      if (vnNow.hour === 8 && vnNow.minute >= 0 && vnNow.minute <= 15) {
        if (localState.lastAutoTelegramDate === vnNow.dateVn) {
          return;
        }
        localState.lastAutoTelegramDate = vnNow.dateVn;
        saveLocalState(localState);

        await getAllSheetsData(true).catch(() => null);
        await sendTelegramReminder({ dateVn: vnNow.dateVn, label: 'HÔM NAY' });
        console.log(`[Telegram 8h00] Đã tự động gửi lịch hẹn ngày ${vnNow.dateVn} vào Telegram.`);
      }
    } catch (err) {
      // Nếu lỗi mạng tạm thời thì cho phép thử lại ở phút kế tiếp trong khung 8h sáng
      localState.lastAutoTelegramDate = '';
      console.warn('[Telegram 8h00] Chưa gửi được tự động:', err?.message || err);
    }
  };

  dailySchedulerTimer = setInterval(checkAndTrigger8Am, 60 * 1000);
  if (typeof dailySchedulerTimer.unref === 'function') {
    dailySchedulerTimer.unref();
  }
  return dailySchedulerTimer;
}

function findRecordInSheet(sheetKey, rowIdx) {
  const base = memoryCache.sheets?.[sheetKey]?.records?.find((r) => r.sheetRowIndex === rowIdx);
  if (base) {
    return applyOverrideToRecord(base, localState.rowOverrides[`${sheetKey}:${rowIdx}`]);
  }
  const added = localState.addedRecords[sheetKey]?.find((r) => r.sheetRowIndex === rowIdx);
  if (added) {
    return applyOverrideToRecord(added, localState.rowOverrides[`${sheetKey}:${rowIdx}`]);
  }
  return null;
}

export function syncRecordLocallyToTargetSheet(
  sourceSheetKey,
  sourceRowIdx,
  targetSheetKey,
  overrideStatus
) {
  const sourceRec = findRecordInSheet(sourceSheetKey, sourceRowIdx);
  if (!sourceRec) return null;

  const targetBase = memoryCache.sheets?.[targetSheetKey]?.records || [];
  const targetAdded = localState.addedRecords[targetSheetKey] || [];
  const normPhone = normalizePhone(sourceRec.phone);

  const existingBase = normPhone ? targetBase.find((r) => r.phone === normPhone) : null;
  if (existingBase) {
    const key = `${targetSheetKey}:${existingBase.sheetRowIndex}`;
    const prevTargetOverride = localState.rowOverrides[key] || {};
    const nextTargetOverride = {
      ...prevTargetOverride,
      status: overrideStatus || sourceRec.status,
      telesale: sourceRec.telesale,
      noteM: sourceRec.noteM,
      customerInfo: sourceRec.customerInfo,
      apptTime: sourceRec.apptTime,
      apptDate: sourceRec.apptDate,
      careHistory: Array.isArray(sourceRec.careHistory) ? [...sourceRec.careHistory] : [],
      updatedAt: new Date().toISOString(),
    };
    delete nextTargetOverride.careAdditions;
    localState.rowOverrides[key] = nextTargetOverride;
    saveLocalState(localState);
    return { targetSheetKey, sheetRowIndex: existingBase.sheetRowIndex };
  }

  const existingAddedIdx = normPhone
    ? targetAdded.findIndex((r) => r.phone === normPhone)
    : -1;
  const statusInfo = classifyStatus(overrideStatus || sourceRec.status);

  if (existingAddedIdx !== -1) {
    targetAdded[existingAddedIdx] = {
      ...targetAdded[existingAddedIdx],
      ...sourceRec,
      id: `${targetSheetKey}-row-${targetAdded[existingAddedIdx].sheetRowIndex}`,
      sheetKey: targetSheetKey,
      sheetRowIndex: targetAdded[existingAddedIdx].sheetRowIndex,
      status: statusInfo.status,
      canonicalStatus: statusInfo.canonicalStatus,
      statusLabel: statusInfo.statusLabel,
      statusGroup: statusInfo.statusGroup,
      badgeColor: statusInfo.badgeColor,
    };
    saveLocalState(localState);
    return { targetSheetKey, sheetRowIndex: targetAdded[existingAddedIdx].sheetRowIndex };
  }

  const maxRow = Math.max(
    600,
    ...targetBase.map((r) => r.sheetRowIndex),
    ...targetAdded.map((r) => r.sheetRowIndex)
  );
  const newRowIndex = maxRow + 1;

  const newRecord = {
    ...sourceRec,
    id: `${targetSheetKey}-row-${newRowIndex}`,
    sheetKey: targetSheetKey,
    sheetRowIndex: newRowIndex,
    status: statusInfo.status,
    canonicalStatus: statusInfo.canonicalStatus,
    statusLabel: statusInfo.statusLabel,
    statusGroup: statusInfo.statusGroup,
    badgeColor: statusInfo.badgeColor,
  };

  localState.addedRecords[targetSheetKey].push(newRecord);
  saveLocalState(localState);
  return { targetSheetKey, sheetRowIndex: newRowIndex };
}
