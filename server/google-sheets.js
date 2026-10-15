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

function saveLocalState(state) {
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

let localState = loadLocalState();
let memoryCache = {
  fetchedAt: 0,
  sheets: null,
};
const CACHE_TTL_MS = 25 * 1000;

async function fetchSheetCsv(sheetKey) {
  ensureDirs();
  const cfg = SHEETS_CONFIG[sheetKey];
  if (!cfg) throw new Error(`Sheet key không hợp lệ: ${sheetKey}`);

  const cacheFile = path.join(CACHE_DIR, `${sheetKey}.csv`);
  const url = buildCsvExportUrl(SPREADSHEET_ID, cfg.gid);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
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
  if (Array.isArray(override.careAdditions) && override.careAdditions.length > 0) {
    const baseHistory = Array.isArray(updated.careHistory) ? [...updated.careHistory] : [];
    for (const item of override.careAdditions) {
      baseHistory.push({
        text: item.text,
        addedAt: item.addedAt || '',
      });
    }
    updated.careHistory = baseHistory;
  }

  return updated;
}

export async function getAllSheetsData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memoryCache.sheets && now - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return buildFullResponse(memoryCache.sheets, memoryCache.fetchedAt);
  }

  const [mktRes, bookedRes, arrivedRes] = await Promise.all([
    fetchSheetCsv('mkt'),
    fetchSheetCsv('booked'),
    fetchSheetCsv('arrived'),
  ]);

  const parsedSheets = {
    mkt: parseSheetRecords(mktRes.csvText, 'mkt', localState.telesaleList),
    booked: parseSheetRecords(bookedRes.csvText, 'booked', localState.telesaleList),
    arrived: parseSheetRecords(arrivedRes.csvText, 'arrived', localState.telesaleList),
  };

  memoryCache = {
    fetchedAt: now,
    sheets: parsedSheets,
  };

  return buildFullResponse(parsedSheets, now);
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
 */
function buildFullResponse(parsedSheets, fetchedAt) {
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

  const activeTelesales = getActiveTelesaleNames();
  const rawPayload = {
    ok: true,
    fetchedAt: new Date(fetchedAt).toISOString(),
    telesaleList: activeTelesales.length > 0 ? activeTelesales : localState.telesaleList,
    statusOptions: STATUS_OPTIONS,
    quickNoteTemplates: QUICK_NOTE_TEMPLATES,
    sheets: mergedSheets,
  };

  return sanitizeDataDeep(rawPayload, SPREADSHEET_ID);
}

async function postToAppsScript(payload) {
  const url = localState.appsScriptUrl;
  if (!url) {
    return { synced: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
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

  if (appendCareNoteText && String(appendCareNoteText).trim()) {
    const careList = Array.isArray(nextOverride.careAdditions)
      ? [...nextOverride.careAdditions]
      : [];
    careList.push({
      text: String(appendCareNoteText).trim(),
      addedAt: nowIso,
    });
    nextOverride.careAdditions = careList;
  }

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

  if (appendCareNoteText && String(appendCareNoteText).trim()) {
    await postToAppsScript({
      action: 'appendCareNote',
      sheetKey,
      sheetName: SHEETS_CONFIG[sheetKey].name,
      sheetRowIndex: rowIdx,
      phone,
      name,
      note: String(appendCareNoteText).trim(),
    });
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

  return {
    ok: true,
    overrideKey,
  };
}

export async function sendTelegramReminder({ dateVn = '', label = 'HÔM NAY' } = {}) {
  const allData = await getAllSheetsData(false);
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const targetDateVn = String(dateVn || `${dd}/${mm}/${yyyy}`).trim();
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

  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();

  if (botToken && chatId) {
    const esc = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const lines = [
      `📅 <b>LỊCH HẸN KHÁCH HÀNG ${esc(label)} (${esc(targetDateVn)})</b>`,
      `🏥 <b>Trạm Chữa Da BSN</b> — Tổng: <b>${appts.length} khách</b>`,
      '────────────────────',
    ];

    if (appts.length === 0) {
      lines.push(`Hiện chưa có khách hàng nào có lịch hẹn vào ngày ${esc(targetDateVn)}.`);
    } else {
      appts.forEach((item, idx) => {
        lines.push(
          `<b>${idx + 1}. ${esc(item.name)}</b> — 📞 <code>${esc(
            item.phoneDisplay || item.phone || '—'
          )}</code>`
        );
        lines.push(
          `   • Giờ hẹn: <b>${esc(item.apptTime || 'Chưa báo giờ')}</b> | Tình trạng: <b>${esc(
            item.statusLabel || item.status || 'Đặt Hẹn'
          )}</b>`
        );
        if (item.service || item.customerInfo) {
          lines.push(
            `   • Dịch vụ: ${esc(item.service || '—')}${
              item.customerInfo ? ` (${esc(item.customerInfo)})` : ''
            }`
          );
        }
        lines.push(`   • Telesale: <b>${esc(item.telesale || 'Chưa phân bổ')}</b>`);
        if (item.noteM) {
          lines.push(`   • Ghi chú: <i>${esc(item.noteM)}</i>`);
        }
        lines.push('');
      });
      lines.push(
        '💡 <i>Đội ngũ Telesale vui lòng liên hệ nhắc lịch & hỗ trợ đón khách đúng giờ!</i>'
      );
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const tgJson = await tgRes.json();
    if (!tgJson.ok) {
      throw new Error(tgJson.description || 'Không gửi được tin nhắn Telegram');
    }
    return { ok: true, count: appts.length, dateVn: targetDateVn, via: 'telegram_api' };
  }

  if (localState.appsScriptUrl) {
    const gasRes = await postToAppsScript({
      action: 'sendTelegramReminder',
      dateVn: targetDateVn,
      label,
    });
    if (gasRes.synced) {
      return { ok: true, count: appts.length, dateVn: targetDateVn, via: 'apps_script' };
    }
  }

  throw new Error(
    'Chưa cấu hình TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID trong file .env (hoặc trong Google Apps Script)'
  );
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
    localState.rowOverrides[key] = {
      ...(localState.rowOverrides[key] || {}),
      status: overrideStatus || sourceRec.status,
      telesale: sourceRec.telesale,
      noteM: sourceRec.noteM,
      customerInfo: sourceRec.customerInfo,
      apptTime: sourceRec.apptTime,
      apptDate: sourceRec.apptDate,
      updatedAt: new Date().toISOString(),
    };
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
