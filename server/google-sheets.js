import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT_DIR,
  SPREADSHEET_ID,
  DEFAULT_APPS_SCRIPT_URL,
  DEFAULT_TELEGRAM_BOT_TOKEN,
  DEFAULT_TELEGRAM_CHAT_ID,
  SHEETS_CONFIG,
  DEFAULT_TELESALE_LIST,
  STATUS_OPTIONS,
  SERVICE_OPTIONS,
  SOURCE_OPTIONS,
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

function normalizeTelegramSendTime(rawTime) {
  const str = String(rawTime || '').trim();
  const match = str.match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})?$/);
  if (match) {
    const hh = Math.min(23, Math.max(0, Number(match[1]) || 0));
    const mm = Math.min(59, Math.max(0, Number(match[2] || 0)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return '08:00';
}

function loadLocalState() {
  ensureDirs();
  const defaultState = {
    telesaleList: [...DEFAULT_TELESALE_LIST],
    appsScriptUrl: process.env.GOOGLE_APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL || '',
    autoSyncSheets: true,
    telegramSchedule: {
      enabled: true,
      sendTime: '08:00',
      lastSentDate: '',
      lastSentTime: '',
      lastSentSlotKey: '',
    },
      rowOverrides: {},
      deletedRecords: [],
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
      const rawSched = raw.telegramSchedule || {};
      return {
        ...defaultState,
        ...raw,
        telesaleList: list,
        appsScriptUrl:
          raw.appsScriptUrl || process.env.GOOGLE_APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL || '',
        telegramSchedule: {
          enabled: rawSched.enabled !== undefined ? Boolean(rawSched.enabled) : true,
          sendTime: normalizeTelegramSendTime(rawSched.sendTime || '08:00'),
          lastSentDate: String(rawSched.lastSentDate || raw.lastAutoTelegramDate || ''),
          lastSentTime: String(rawSched.lastSentTime || ''),
          lastSentSlotKey: String(rawSched.lastSentSlotKey || ''),
        },
        rowOverrides: raw.rowOverrides || {},
        deletedRecords: Array.isArray(raw.deletedRecords) ? raw.deletedRecords : [],
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
  if (process.env.NODE_TEST_CONTEXT) {
    return;
  }
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
  if (override.revenueAmount !== undefined) {
    updated.revenueAmount = override.revenueAmount;
  }
  if (override.weekday !== undefined) {
    updated.weekday = override.weekday;
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

export function isRecordDeletedInLocalState(sheetKey, rec, localSnap = localState) {
  const list = localSnap?.deletedRecords;
  if (!Array.isArray(list) || list.length === 0 || !rec) return false;
  const recPhone = normalizePhone(rec.phone || '');
  const recName = String(rec.name || '').trim().toLowerCase();
  const recRow = Number(rec.sheetRowIndex || 0);

  return list.some((del) => {
    if (del.sheetKey !== sheetKey) return false;
    const delPhone = normalizePhone(del.phone || '');
    const delName = String(del.name || '').trim().toLowerCase();
    const delRow = Number(del.sheetRowIndex || 0);

    if (delPhone && recPhone) {
      if (delPhone !== recPhone) return false;
      if (delRow && recRow && delRow === recRow) return true;
      if (delName && recName && delName === recName) return true;
      if (!delName) return true;
      return false;
    }
    if (delRow && recRow && delRow === recRow) {
      if (!delName || !recName || delName === recName) return true;
    }
    return false;
  });
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
    const baseRecords = (parsedSheets[sheetKey]?.records || []).filter(
      (rec) => !isRecordDeletedInLocalState(sheetKey, rec, localState)
    );
    const withOverrides = baseRecords.map((rec) => {
      const key = `${sheetKey}:${rec.sheetRowIndex}`;
      return applyOverrideToRecord(rec, localState.rowOverrides[key]);
    });

    const added = (localState.addedRecords[sheetKey] || [])
      .filter((rec) => !isRecordDeletedInLocalState(sheetKey, rec, localState))
      .map((rec) => {
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
    serviceOptions: SERVICE_OPTIONS,
    sourceOptions: SOURCE_OPTIONS,
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

export function getLocalStateSnapshot() {
  return localState;
}

export function parseAdminRevenueInput(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const str = String(raw).trim().toLowerCase();
  if (!str) return null;

  const trMatch = str.match(/^(\d+)\s*tr(?:iệu)?\s*(\d*)$/i);
  if (trMatch) {
    const millions = Number(trMatch[1]) * 1000000;
    const tailStr = trMatch[2] || '';
    const tail = tailStr ? Number(tailStr.padEnd(6, '0').slice(0, 6)) : 0;
    return millions + tail;
  }

  const kMatch = str.match(/^(\d+(?:[.,]\d+)?)\s*k$/i);
  if (kMatch) {
    return Math.round(Number(kMatch[1].replace(',', '.')) * 1000);
  }

  const digitsOnly = str.replace(/[^\d]/g, '');
  if (!digitsOnly) return null;
  const num = Number(digitsOnly);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function formatVnRevenueCell(amount) {
  const num = parseAdminRevenueInput(amount);
  if (num === null) return '';
  return `${num.toLocaleString('vi-VN')} ₫`;
}

export function computeVnWeekday(vnDateOrIso) {
  const iso = parseVnDateToIso(vnDateOrIso);
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getUTCDay();
  const labels = ['Chúa Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return labels[day] || '';
}

// ============================================================================
// GOOGLE SHEETS REST API V4 (DIRECT SERVICE ACCOUNT WRITER FOR COOLIFY)
// ============================================================================
let cachedGoogleToken = {
  accessToken: '',
  expiresAt: 0,
};

function loadServiceAccountCredentials() {
  try {
    const b64 = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || '').trim();
    if (b64) {
      const jsonText = Buffer.from(b64, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonText);
      if (parsed?.client_email && parsed?.private_key) return parsed;
    }
    const filePath =
      process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '/run/secrets/google-service-account.json';
    if (filePath && fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed?.client_email && parsed?.private_key) return parsed;
    }
  } catch {
    // Ignore credential parse errors
  }
  return null;
}

async function getServiceAccountAccessToken() {
  const now = Date.now();
  if (cachedGoogleToken.accessToken && cachedGoogleToken.expiresAt > now + 60 * 1000) {
    return cachedGoogleToken.accessToken;
  }
  const creds = loadServiceAccountCredentials();
  if (!creds) return null;

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claimB64 = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp,
    })
  ).toString('base64url');

  const signingInput = `${headerB64}.${claimB64}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(creds.private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.access_token) return null;

  cachedGoogleToken = {
    accessToken: data.access_token,
    expiresAt: now + Number(data.expires_in || 3500) * 1000,
  };
  return data.access_token;
}

async function sheetsApiGetValues(rangeA1) {
  const token = await getServiceAccountAccessToken();
  if (!token) return null;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
    rangeA1
  )}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data?.values) ? data.values : [];
}

async function sheetsApiBatchUpdateValues(dataRanges) {
  const token = await getServiceAccountAccessToken();
  if (!token || !Array.isArray(dataRanges) || dataRanges.length === 0) return false;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: dataRanges,
    }),
  });
  return res.ok;
}

async function sheetsApiDeleteRow(sheetId, rowIndex1Based) {
  const token = await getServiceAccountAccessToken();
  const numericSheetId = Number(sheetId);
  if (!token || !Number.isFinite(numericSheetId) || rowIndex1Based < 2) return false;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: numericSheetId,
              dimension: 'ROWS',
              startIndex: rowIndex1Based - 1,
              endIndex: rowIndex1Based,
            },
          },
        },
      ],
    }),
  });
  return res.ok;
}

async function deleteRowFromSheetViaApi(
  targetSheetKey,
  { rowIdx = 0, phone = '', name = '' } = {}
) {
  try {
    const cfg = SHEETS_CONFIG[targetSheetKey];
    if (!cfg) return false;
    const rows = await sheetsApiGetValues(`'${cfg.name}'!A1:G2000`);
    if (!rows || rows.length < 2) return false;

    const targetPhone = normalizePhone(phone);
    const targetName = String(name || '').trim().toLowerCase();

    const isSeparatorRow = (rowArr) => {
      if (!rowArr) return true;
      const hasC = String(rowArr[2] || '').trim();
      const hasD = String(rowArr[3] || '').trim();
      const colG = String(rowArr[6] || '').trim().toUpperCase();
      return !hasC && !hasD && colG.startsWith('THÁNG');
    };

    const matchesRow = (rowArr) => {
      if (!rowArr || isSeparatorRow(rowArr)) return false;
      const rPhone = normalizePhone(rowArr[3]);
      const rName = String(rowArr[2] || '').trim().toLowerCase();
      if (targetPhone && rPhone) {
        return rPhone === targetPhone;
      }
      if (!targetPhone && targetName && rName) {
        return rName === targetName;
      }
      return false;
    };

    let actualRow = -1;
    if (rowIdx >= 2 && rowIdx <= rows.length && matchesRow(rows[rowIdx - 1])) {
      actualRow = rowIdx;
    } else {
      if (targetPhone && targetName) {
        for (let i = rows.length - 1; i >= 1; i--) {
          if (isSeparatorRow(rows[i])) continue;
          const rPhone = normalizePhone(rows[i]?.[3]);
          const rName = String(rows[i]?.[2] || '').trim().toLowerCase();
          if (rPhone === targetPhone && rName === targetName) {
            actualRow = i + 1;
            break;
          }
        }
      }
      if (actualRow < 2) {
        for (let i = rows.length - 1; i >= 1; i--) {
          if (matchesRow(rows[i])) {
            actualRow = i + 1;
            break;
          }
        }
      }
    }

    if (actualRow < 2) return false;
    return await sheetsApiDeleteRow(Number(cfg.gid), actualRow);
  } catch {
    return false;
  }
}

async function upsertRowViaSheetsApi(targetSheetName, row23, overrideStatus) {
  const existingRows = await sheetsApiGetValues(`'${targetSheetName}'!A1:G2000`);
  if (!existingRows) return null;

  const targetPhone = normalizePhone(row23[3]);
  const copyRow = [...row23];
  while (copyRow.length < 23) copyRow.push('');
  if (overrideStatus) copyRow[8] = overrideStatus;
  if (targetPhone) copyRow[3] = `'${targetPhone}`;

  let targetRowIdx = -1;
  if (targetPhone && existingRows.length >= 2) {
    for (let i = existingRows.length - 1; i >= 1; i--) {
      if (normalizePhone(existingRows[i]?.[3]) === targetPhone) {
        targetRowIdx = i + 1;
        break;
      }
    }
  }

  if (targetRowIdx === -1) {
    let lastOccupied = 1;
    for (let i = existingRows.length - 1; i >= 1; i--) {
      const hasNameOrPhone =
        String(existingRows[i]?.[2] || '').trim() || String(existingRows[i]?.[3] || '').trim();
      const isSeparator = String(existingRows[i]?.[6] || '')
        .trim()
        .toUpperCase()
        .startsWith('THÁNG');
      if (hasNameOrPhone || isSeparator) {
        lastOccupied = i + 1;
        break;
      }
    }
    targetRowIdx = lastOccupied + 1;
  }

  const batchRanges = [
    {
      range: `'${targetSheetName}'!B${targetRowIdx}:M${targetRowIdx}`,
      values: [copyRow.slice(1, 13)],
    },
  ];
  if (copyRow[21] || copyRow[22]) {
    batchRanges.push({
      range: `'${targetSheetName}'!V${targetRowIdx}:W${targetRowIdx}`,
      values: [[copyRow[21] || '', copyRow[22] || '']],
    });
  }
  const ok = await sheetsApiBatchUpdateValues(batchRanges);
  return ok ? targetRowIdx : null;
}

async function syncLeadViaSheetsApi(
  lead,
  { syncBooked = false, syncArrived = false, revenueText = '', weekday = '' } = {}
) {
  try {
    const mktName = SHEETS_CONFIG.mkt.name;
    const rows = await sheetsApiGetValues(`'${mktName}'!A1:G2000`);
    if (!rows) return false;

    let lastCustomerRow = 2;
    for (let i = rows.length - 1; i >= 1; i--) {
      const hasNameOrPhone =
        String(rows[i]?.[2] || '').trim() || String(rows[i]?.[3] || '').trim();
      const isSeparator = String(rows[i]?.[6] || '')
        .trim()
        .toUpperCase()
        .startsWith('THÁNG');
      if (hasNameOrPhone || isSeparator) {
        lastCustomerRow = i + 1;
        break;
      }
    }

    const targetRow = lastCustomerRow + 1;
    const phoneStr = normalizePhone(lead.phone);
    const row23 = [
      '',
      lead.dataDate || '',
      lead.name || '',
      phoneStr ? `'${phoneStr}` : '',
      lead.service || '',
      lead.source || 'Ads FB Mess',
      lead.fbLink || '',
      lead.customerInfo || '',
      lead.status || '',
      lead.apptTime || '',
      lead.apptDate || '',
      lead.telesale || '',
      lead.noteM || '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      weekday || '',
      revenueText || '',
    ];

    const mktBatch = [
      {
        range: `'${mktName}'!B${targetRow}:M${targetRow}`,
        values: [row23.slice(1, 13)],
      },
    ];
    if (weekday || revenueText) {
      mktBatch.push({
        range: `'${mktName}'!V${targetRow}:W${targetRow}`,
        values: [[weekday || '', revenueText || '']],
      });
    }
    const updatedOk = await sheetsApiBatchUpdateValues(mktBatch);
    if (!updatedOk) return false;

    if (syncBooked) {
      const bookedStatus =
        String(lead.status || '').toUpperCase().includes('DỜI LỊCH') ? 'DỜI LỊCH' : 'ĐẶT HẸN';
      await upsertRowViaSheetsApi(SHEETS_CONFIG.booked.name, row23, bookedStatus);
    }
    if (syncArrived) {
      await upsertRowViaSheetsApi(SHEETS_CONFIG.arrived.name, row23, 'ĐÃ ĐẾN');
    }
    return true;
  } catch {
    return false;
  }
}

async function syncInteractionViaSheetsApi({
  sheetKey,
  rowIdx,
  phone,
  updates,
  cleanCareAppend,
  revenueText,
  weekday,
}) {
  try {
    const sheetName = SHEETS_CONFIG[sheetKey]?.name;
    if (!sheetName) return false;
    const rows = await sheetsApiGetValues(`'${sheetName}'!A1:W2000`);
    if (!rows) return false;

    const targetPhone = normalizePhone(phone);
    let actualRow = rowIdx;
    if (actualRow >= 2 && actualRow <= rows.length && targetPhone) {
      const rowPhone = normalizePhone(rows[actualRow - 1]?.[3]);
      if (rowPhone !== targetPhone) {
        actualRow = -1;
      }
    }
    if (actualRow < 2 || actualRow > rows.length) {
      if (targetPhone) {
        for (let i = rows.length - 1; i >= 1; i--) {
          if (normalizePhone(rows[i]?.[3]) === targetPhone) {
            actualRow = i + 1;
            break;
          }
        }
      }
    }
    if (!actualRow || actualRow < 2) return false;

    const currentRow = [...(rows[actualRow - 1] || [])];
    while (currentRow.length < 23) currentRow.push('');

    if (updates.customerInfo !== undefined) currentRow[7] = updates.customerInfo;
    if (updates.status !== undefined) currentRow[8] = updates.status;
    if (updates.apptTime !== undefined) currentRow[9] = updates.apptTime;
    if (updates.apptDate !== undefined) currentRow[10] = updates.apptDate;
    if (updates.telesale !== undefined) currentRow[11] = updates.telesale;
    if (updates.noteM !== undefined) currentRow[12] = updates.noteM;
    if (weekday) currentRow[21] = weekday;
    if (revenueText !== undefined && revenueText !== null) currentRow[22] = revenueText;

    if (Array.isArray(updates.careHistory)) {
      const careTexts = updates.careHistory
        .map((c) => String(c?.text ?? c ?? '').trim())
        .filter(Boolean);
      for (let k = 0; k < 8; k++) {
        currentRow[13 + k] = k < careTexts.length ? careTexts[k] : '';
      }
    } else if (cleanCareAppend) {
      let placed = false;
      for (let colIdx = 12; colIdx <= 20; colIdx++) {
        if (!String(currentRow[colIdx] || '').trim()) {
          currentRow[colIdx] = cleanCareAppend;
          placed = true;
          break;
        }
      }
      if (!placed) currentRow[20] = cleanCareAppend;
    }

    const batch = [
      {
        range: `'${sheetName}'!H${actualRow}:U${actualRow}`,
        values: [currentRow.slice(7, 21)],
      },
    ];
    if (weekday || revenueText !== undefined) {
      batch.push({
        range: `'${sheetName}'!V${actualRow}:W${actualRow}`,
        values: [[currentRow[21] || '', currentRow[22] || '']],
      });
    }
    const updatedOk = await sheetsApiBatchUpdateValues(batch);
    if (!updatedOk) return false;

    const statusUpper = String(currentRow[8] || '').trim().toUpperCase();
    const hasApptDate = Boolean(String(currentRow[10] || '').trim());

    if (
      sheetKey === 'mkt' &&
      (statusUpper.includes('ĐẶT HẸN') ||
        statusUpper.includes('ĐẶT LỊCH') ||
        statusUpper.includes('DỜI LỊCH') ||
        hasApptDate)
    ) {
      const targetBookedStatus = statusUpper.includes('DỜI LỊCH') ? 'DỜI LỊCH' : 'ĐẶT HẸN';
      await upsertRowViaSheetsApi(SHEETS_CONFIG.booked.name, currentRow, targetBookedStatus);
    }

    if (sheetKey !== 'arrived' && (statusUpper === 'ĐÃ ĐẾN' || statusUpper === 'ĐẾN VÀ VỀ')) {
      await upsertRowViaSheetsApi(
        SHEETS_CONFIG.arrived.name,
        currentRow,
        statusUpper === 'ĐẾN VÀ VỀ' ? 'ĐẾN VÀ VỀ' : 'ĐÃ ĐẾN'
      );
    }

    return true;
  } catch {
    return false;
  }
}

async function postToAppsScript(payload) {
  const url =
    localState.appsScriptUrl || process.env.GOOGLE_APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;
  if (!url) {
    return { synced: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    timer.unref?.();
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
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
  const currentRecBefore = findRecordInSheet(sheetKey, rowIdx);

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

  // Yêu cầu 4: Nếu nhân sự chọn Ngày hẹn cụ thể ở Sheet 1 mà Tình trạng đang trống (Chưa gọi), tự động chuyển sang ĐẶT HẸN
  const effectiveApptDateNow = String(
    updates.apptDate !== undefined ? updates.apptDate : currentRecBefore?.apptDate || ''
  ).trim();
  const effectiveStatusBeforeAuto = String(
    updates.status !== undefined ? updates.status : currentRecBefore?.status || ''
  ).trim();
  if (updates.apptDate && effectiveApptDateNow && !effectiveStatusBeforeAuto) {
    nextOverride.status = 'ĐẶT HẸN';
    updates.status = 'ĐẶT HẸN';
  }

  // Yêu cầu 5: Xử lý Doanh số (Cột W) khi Admin chuyển sang ĐÃ ĐẾN hoặc cập nhật doanh số
  let revenueTextForSheet;
  let parsedRevAmount = null;
  if (updates.revenue !== undefined) {
    parsedRevAmount = parseAdminRevenueInput(updates.revenue);
    nextOverride.revenueAmount = parsedRevAmount;
    revenueTextForSheet = parsedRevAmount !== null ? formatVnRevenueCell(parsedRevAmount) : '';
    const normP = normalizePhone(phone || currentRecBefore?.phone || '');
    if (normP) {
      if (!localState.revenueByPhone) localState.revenueByPhone = {};
      localState.revenueByPhone[normP] = parsedRevAmount;
    }
  }

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

  const currentRec = findRecordInSheet(sheetKey, rowIdx);
  const effectiveStatus =
    nextOverride.status !== undefined ? nextOverride.status : currentRec?.status || '';
  const statusInfo = classifyStatus(effectiveStatus);
  const hasSpecificAppt = Boolean((nextOverride.apptDate ?? currentRec?.apptDate ?? '').trim());
  const vnToday = getVnDateParts(new Date());
  const weekdayText =
    statusInfo.statusGroup === 'arrived'
      ? computeVnWeekday(currentRec?.apptDate || vnToday.dateVn)
      : '';

  if (localState.autoSyncSheets) {
    // Yêu cầu 4: Khi bất kỳ ai chuyển trạng thái sang Đặt hẹn HOẶC có lịch hẹn cụ thể -> thêm vào 2) KHÁCH ĐẶT HẸN
    if (sheetKey === 'mkt' && (statusInfo.statusGroup === 'booked' || hasSpecificAppt)) {
      const targetStatus =
        statusInfo.canonicalStatus === 'DỜI LỊCH' ? 'DỜI LỊCH' : 'ĐẶT HẸN';
      syncRecordLocallyToTargetSheet('mkt', rowIdx, 'booked', targetStatus);
    }
    // Yêu cầu 5: Khi Admin chuyển sang ĐÃ ĐẾN -> chuyển qua 3) KHÁCH ĐÃ ĐẾN kèm Doanh số Cột W
    if (statusInfo.statusGroup === 'arrived') {
      if (sheetKey !== 'arrived') {
        syncRecordLocallyToTargetSheet(
          sheetKey,
          rowIdx,
          'arrived',
          statusInfo.canonicalStatus === 'ĐẾN VÀ VỀ' ? 'ĐẾN VÀ VỀ' : 'ĐÃ ĐẾN',
          {
            revenueAmount:
              parsedRevAmount !== null ? parsedRevAmount : existingOverride.revenueAmount ?? null,
            weekday: weekdayText,
          }
        );
      }
    }
  }

  saveLocalState(localState);

  // Đồng bộ ngầm (non-blocking) lên Google Sheet qua cả Service Account API v4 lẫn Google Apps Script
  if (!process.env.NODE_TEST_CONTEXT) {
    const syncUpdates = { ...updates };
    if (revenueTextForSheet !== undefined) {
      syncUpdates.revenue = revenueTextForSheet;
    }
    if (weekdayText) {
      syncUpdates.weekday = weekdayText;
    }
    void (async () => {
      const apiSynced = await syncInteractionViaSheetsApi({
        sheetKey,
        rowIdx,
        phone: phone || currentRec?.phone,
        updates: syncUpdates,
        cleanCareAppend,
        revenueText: revenueTextForSheet,
        weekday: weekdayText,
      });

      if (!apiSynced) {
        await postToAppsScript({
          action: 'updateInteraction',
          sheetKey,
          sheetName: SHEETS_CONFIG[sheetKey].name,
          sheetRowIndex: rowIdx,
          phone: phone || currentRec?.phone,
          name: name || currentRec?.name,
          updates: syncUpdates,
          autoSyncSheets: localState.autoSyncSheets,
        });

        if (cleanCareAppend) {
          await postToAppsScript({
            action: 'appendCareNote',
            sheetKey,
            sheetName: SHEETS_CONFIG[sheetKey].name,
            sheetRowIndex: rowIdx,
            phone: phone || currentRec?.phone,
            name: name || currentRec?.name,
            note: cleanCareAppend,
          });
        }
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
    ? `${esc(statusText)} 🔴 (Cần gọi nhắc)`
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
    `   📌 Tình trạng: ${statusBadge}`,
    `   👩‍💼 Telesale: <b>${esc(telesaleText)}</b>`,
    `   ℹ️ TT Khách: ${esc(custInfoText)}`,
    `   📝 Ghi chú: ${esc(allNotes || '—')}`,
  ];
}

export function formatBatchAppointmentsTelegramMessage(appts, targetDateVn, label = 'HÔM NAY') {
  const esc = escapeTelegramHtml;
  const needCallCount = appts.filter(
    (r) => r.statusGroup !== 'arrived' && r.statusGroup !== 'lost'
  ).length;

  const lines = [
    `📅 <b>LỊCH HẸN KHÁCH HÀNG — ${esc(label)} (${esc(targetDateVn)})</b>`,
    `<b>Trạm Chữa Da BSN</b> • Tổng cộng: <b>${appts.length} khách hẹn</b> (${needCallCount} khách cần gọi nhắc)`,
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

export function formatSingleCustomerTelegramMessage(rec, fallbackDateVn = '') {
  const esc = escapeTelegramHtml;
  const apptDateText =
    rec.apptDate || fallbackDateVn || rec.dataDate || getVnDateParts().dateVn;
  const lines = [
    `📅 <b>LỊCH HẸN KHÁCH HÀNG — (${esc(apptDateText)})</b>`,
    `<b>Trạm Chữa Da BSN</b> • Thông tin khách lẻ`,
    '━━━━━━━━━━━━━━━━━━━━',
    ...formatCustomerTelegramItemLines(rec, 1),
  ];
  return lines.join('\n');
}

function normalizeTelegramChatId(rawChatId) {
  const str = String(rawChatId || '').trim();
  if (!str) return '-1004467285585';
  // If user pasted full URL like https://web.telegram.org/k/#-4467285585
  const hashMatch = str.match(/#(-?\d+)$/);
  const extracted = hashMatch ? hashMatch[1] : str;
  if (extracted === '-4467285585') return '-1004467285585';
  return extracted;
}

async function dispatchTelegramHtmlText(htmlText, fallbackAppsScriptPayload = null) {
  const botToken = String(
    process.env.TELEGRAM_BOT_TOKEN || DEFAULT_TELEGRAM_BOT_TOKEN || ''
  ).trim();
  const chatId = normalizeTelegramChatId(
    process.env.TELEGRAM_CHAT_ID || DEFAULT_TELEGRAM_CHAT_ID || '-1004467285585'
  );

  if (botToken && chatId) {
    const sendWithChatId = async (targetChatId) => {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      return tgRes.json();
    };

    let tgJson = await sendWithChatId(chatId);
    if (!tgJson.ok) {
      const migratedId =
        tgJson.parameters?.migrate_to_chat_id ||
        (chatId.startsWith('-') && !chatId.startsWith('-100') ? `-100${chatId.slice(1)}` : null);
      if (migratedId && String(migratedId) !== String(chatId)) {
        tgJson = await sendWithChatId(String(migratedId));
      }
    }
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

export function getTelegramScheduleConfig() {
  const sched = localState.telegramSchedule || {};
  return {
    enabled: sched.enabled !== undefined ? Boolean(sched.enabled) : true,
    sendTime: normalizeTelegramSendTime(sched.sendTime || '08:00'),
    lastSentDate: String(sched.lastSentDate || ''),
    lastSentTime: String(sched.lastSentTime || ''),
  };
}

export async function updateTelegramScheduleConfig(payload = {}) {
  const prev = getTelegramScheduleConfig();
  const nextEnabled =
    payload.enabled !== undefined ? Boolean(payload.enabled) : prev.enabled;
  const nextSendTime =
    payload.sendTime !== undefined
      ? normalizeTelegramSendTime(payload.sendTime)
      : prev.sendTime;

  localState.telegramSchedule = {
    ...(localState.telegramSchedule || {}),
    enabled: nextEnabled,
    sendTime: nextSendTime,
  };
  saveLocalState(localState);

  if (localState.appsScriptUrl) {
    postToAppsScript({
      action: 'updateTelegramSchedule',
      enabled: nextEnabled,
      sendTime: nextSendTime,
    }).catch(() => {});
  }

  return getTelegramScheduleConfig();
}

let dailySchedulerTimer = null;

export function startDailyTelegramScheduler() {
  if (dailySchedulerTimer) return dailySchedulerTimer;

  const checkAndTriggerScheduledTelegram = async () => {
    try {
      const cfg = getTelegramScheduleConfig();
      if (!cfg.enabled) return;

      const vnNow = getVnDateParts(new Date());
      const [hStr, mStr] = cfg.sendTime.split(':');
      const targetHour = Number(hStr) || 8;
      const targetMin = Number(mStr) || 0;

      const nowTotalMinutes = vnNow.hour * 60 + vnNow.minute;
      const targetTotalMinutes = targetHour * 60 + targetMin;

      // Tự động gửi khi đến đúng giờ cài đặt (trong khung 15 phút từ giờ cài đặt để tránh lỡ nhịp khi khởi động lại server)
      if (nowTotalMinutes >= targetTotalMinutes && nowTotalMinutes <= targetTotalMinutes + 15) {
        const slotKey = `${vnNow.dateVn}@${cfg.sendTime}`;
        if (localState.telegramSchedule?.lastSentSlotKey === slotKey) {
          return;
        }
        const nowTimeText = `${String(vnNow.hour).padStart(2, '0')}:${String(
          vnNow.minute
        ).padStart(2, '0')}`;
        localState.telegramSchedule = {
          ...(localState.telegramSchedule || {}),
          enabled: cfg.enabled,
          sendTime: cfg.sendTime,
          lastSentDate: vnNow.dateVn,
          lastSentTime: nowTimeText,
          lastSentSlotKey: slotKey,
        };
        localState.lastAutoTelegramDate = vnNow.dateVn;
        saveLocalState(localState);

        await getAllSheetsData(true).catch(() => null);
        await sendTelegramReminder({ dateVn: vnNow.dateVn, label: 'HÔM NAY' });
        console.log(
          `[Telegram Auto ${cfg.sendTime}] Đã tự động gửi lịch hẹn ngày ${vnNow.dateVn} vào Telegram.`
        );
      }
    } catch (err) {
      // Nếu lỗi mạng tạm thời thì xóa khoá slot để thử lại ở nhịp kế tiếp
      if (localState.telegramSchedule) {
        localState.telegramSchedule.lastSentSlotKey = '';
      }
      console.warn('[Telegram Auto] Chưa gửi được tự động:', err?.message || err);
    }
  };

  dailySchedulerTimer = setInterval(checkAndTriggerScheduledTelegram, 20 * 1000);
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
  overrideStatus,
  extraFields = {}
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
    if (extraFields.revenueAmount !== undefined && extraFields.revenueAmount !== null) {
      nextTargetOverride.revenueAmount = extraFields.revenueAmount;
    }
    if (extraFields.weekday) {
      nextTargetOverride.weekday = extraFields.weekday;
    }
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
    const mergedRec = {
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
    if (extraFields.revenueAmount !== undefined && extraFields.revenueAmount !== null) {
      mergedRec.revenueAmount = extraFields.revenueAmount;
    }
    if (extraFields.weekday) {
      mergedRec.weekday = extraFields.weekday;
    }
    targetAdded[existingAddedIdx] = mergedRec;
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
  if (extraFields.revenueAmount !== undefined && extraFields.revenueAmount !== null) {
    newRecord.revenueAmount = extraFields.revenueAmount;
  }
  if (extraFields.weekday) {
    newRecord.weekday = extraFields.weekday;
  }

  localState.addedRecords[targetSheetKey].push(newRecord);
  saveLocalState(localState);
  return { targetSheetKey, sheetRowIndex: newRowIndex };
}

function normalizeDateInputToVn(rawDate, fallbackVn = '') {
  const s = String(rawDate || '').trim();
  if (!s) return fallbackVn;
  const iso = parseVnDateToIso(s);
  if (iso) {
    const [yyyy, mm, dd] = iso.split('-');
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

/**
 * Thêm khách hàng mới từ tư vấn Messenger (chỉ dành cho Admin)
 * Mapping chuẩn các cột trên Google Sheet:
 * - Cột B: dataDate (Ngày add data)
 * - Cột C: name (Tên khách hàng)
 * - Cột D: phone (Số điện thoại)
 * - Cột E: service (Loại dịch vụ: Nâng cơ 999k, Mũi sợi 1tr999, Mũi sợi 2tr999, hoặc Khác tự điền)
 * - Cột F: source (Nguồn: Ads FB Mess, Giới thiệu, Gọi điện trực tiếp, Google, hoặc Khác tự điền)
 * - Cột G: fbLink (Link Facebook)
 * - Cột H: customerInfo (Note từ tư vấn Messenger)
 * - Cột I: status (Tình trạng)
 * - Cột J: apptTime (Giờ hẹn)
 * - Cột K: apptDate (Ngày hẹn)
 * - Cột L: telesale (Nhân sự Telesale phụ trách)
 * - Cột M: noteM (Ghi chú Telesale)
 * - Cột W: revenue (Doanh số nếu trạng thái là ĐÃ ĐẾN)
 */
export async function addAdminLead(payload = {}) {
  const vnToday = getVnDateParts(new Date());
  const dataDate = normalizeDateInputToVn(payload.dataDate, vnToday.dateVn);
  const name = String(payload.name || '').trim() || 'Khách chưa rõ tên';
  const rawPhone = String(payload.phone || '').trim();
  const normalizedPhone = normalizePhone(rawPhone);

  if (!normalizedPhone && (!payload.name || !String(payload.name).trim())) {
    throw new Error('Vui lòng nhập Tên khách hàng hoặc Số điện thoại hợp lệ');
  }

  const service = String(payload.service || '').trim();
  const source = String(payload.source || '').trim() || 'Ads FB Mess';
  const fbLink = String(payload.fbLink || '').trim();
  const customerInfo = String(payload.customerInfo || '').trim();
  const apptTime = String(payload.apptTime || '').trim();
  const apptDate = normalizeDateInputToVn(payload.apptDate, '');
  const telesale = String(payload.telesale || '').trim().toUpperCase();
  const noteM = String(payload.noteM || '').trim();

  // Nếu có lịch hẹn cụ thể (Cột K) mà chưa chọn Tình trạng (Cột I), tự động đặt là ĐẶT HẸN
  let rawStatus = String(payload.status || '').trim();
  if (apptDate && !rawStatus) {
    rawStatus = 'ĐẶT HẸN';
  }
  const statusInfo = classifyStatus(rawStatus);

  let parsedRevAmount = null;
  let revenueTextForSheet = '';
  if (payload.revenue !== undefined && payload.revenue !== null && String(payload.revenue).trim() !== '') {
    parsedRevAmount = parseAdminRevenueInput(payload.revenue);
    if (parsedRevAmount !== null) {
      revenueTextForSheet = formatVnRevenueCell(parsedRevAmount);
      if (normalizedPhone) {
        if (!localState.revenueByPhone) localState.revenueByPhone = {};
        localState.revenueByPhone[normalizedPhone] = parsedRevAmount;
      }
    }
  }

  const weekdayText =
    statusInfo.statusGroup === 'arrived'
      ? computeVnWeekday(apptDate || dataDate || vnToday.dateVn)
      : '';

  const mktBase = memoryCache.sheets?.mkt?.records || [];
  const mktAdded = localState.addedRecords.mkt || [];
  const maxRow = Math.max(
    800,
    ...mktBase.map((r) => r.sheetRowIndex),
    ...mktAdded.map((r) => r.sheetRowIndex)
  );
  const newRowIndex = maxRow + 1;

  const dataDateIso = parseVnDateToIso(dataDate);
  const apptDateIso = parseVnDateToIso(apptDate);
  const monthNum = dataDateIso ? Number(dataDateIso.slice(5, 7)) : Number(vnToday.dateIso.slice(5, 7));
  const currentSection = `THÁNG ${monthNum}`;
  const monthKey = dataDateIso
    ? `${dataDateIso.slice(5, 7)}/${dataDateIso.slice(0, 4)}`
    : apptDateIso
    ? `${apptDateIso.slice(5, 7)}/${apptDateIso.slice(0, 4)}`
    : currentSection;

  const newRecord = {
    id: `mkt-row-${newRowIndex}`,
    sheetKey: 'mkt',
    sheetRowIndex: newRowIndex,
    section: currentSection,
    monthKey,
    stt: String(mktBase.length + mktAdded.length + 1),
    dataDate,
    dataDateIso,
    name,
    phone: normalizedPhone,
    rawPhone: rawPhone || normalizedPhone,
    phoneDisplay: formatPhoneDisplay(normalizedPhone || rawPhone),
    service,
    source,
    fbLink,
    customerInfo,
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
    careHistory: [],
  };

  if (parsedRevAmount !== null) {
    newRecord.revenueAmount = parsedRevAmount;
  }
  if (weekdayText) {
    newRecord.weekday = weekdayText;
  }

  if (!Array.isArray(localState.addedRecords.mkt)) {
    localState.addedRecords.mkt = [];
  }
  if (Array.isArray(localState.deletedRecords) && localState.deletedRecords.length > 0) {
    localState.deletedRecords = localState.deletedRecords.filter((del) => {
      const delPhone = normalizePhone(del.phone || '');
      if (normalizedPhone && delPhone === normalizedPhone) return false;
      return true;
    });
  }
  localState.addedRecords.mkt.push(newRecord);

  // Yêu cầu 4: Khi trạng thái là Đặt hẹn HOẶC có lịch hẹn cụ thể -> thêm Data vào sheet 2) KHÁCH ĐẶT HẸN
  let syncedBooked = null;
  if (statusInfo.statusGroup === 'booked' || Boolean(apptDate)) {
    const bookedStatus = statusInfo.canonicalStatus === 'DỜI LỊCH' ? 'DỜI LỊCH' : 'ĐẶT HẸN';
    syncedBooked = syncRecordLocallyToTargetSheet('mkt', newRowIndex, 'booked', bookedStatus);
  }

  // Yêu cầu 5: Khi trạng thái là ĐÃ ĐẾN -> chuyển qua sheet 3) KHÁCH ĐÃ ĐẾN kèm doanh số Cột W
  let syncedArrived = null;
  if (statusInfo.statusGroup === 'arrived') {
    const arrivedStatus = statusInfo.canonicalStatus === 'ĐẾN VÀ VỀ' ? 'ĐẾN VÀ VỀ' : 'ĐÃ ĐẾN';
    syncedArrived = syncRecordLocallyToTargetSheet('mkt', newRowIndex, 'arrived', arrivedStatus, {
      revenueAmount: parsedRevAmount,
      weekday: weekdayText,
    });
  }

  saveLocalState(localState);

  const leadSyncPayload = {
    stt: newRecord.stt,
    dataDate,
    name,
    phone: normalizedPhone || rawPhone,
    service,
    source,
    fbLink,
    customerInfo,
    status: statusInfo.status,
    apptTime,
    apptDate,
    telesale,
    noteM,
    weekday: weekdayText,
    revenueText: revenueTextForSheet,
  };

  if (!process.env.NODE_TEST_CONTEXT) {
    void (async () => {
      const apiSynced = await syncLeadViaSheetsApi(leadSyncPayload, {
        syncBooked: Boolean(syncedBooked),
        syncArrived: Boolean(syncedArrived),
        revenueText: revenueTextForSheet,
        weekday: weekdayText,
      });
      if (!apiSynced) {
        await postToAppsScript({
          action: 'addLead',
          ...leadSyncPayload,
          revenue: revenueTextForSheet,
          autoSyncSheets: localState.autoSyncSheets,
        });
      }
    })();
  }

  // Trả về bản ghi đã ẩn thông tin nhạy cảm (fbLink, revenue) khi phản hồi JSON
  const cleanRecord = { ...newRecord };
  delete cleanRecord.fbLink;
  delete cleanRecord.revenue;
  delete cleanRecord.revenueAmount;

  return {
    ok: true,
    record: cleanRecord,
    syncedBooked: Boolean(syncedBooked),
    syncedArrived: Boolean(syncedArrived),
  };
}

/**
 * Xóa khách hàng khỏi CRM và xóa dòng dữ liệu tương ứng trên Google Sheet (Chỉ dành cho Admin)
 */
export async function deleteAdminLead(payload = {}) {
  const recordId = String(payload.recordId || payload.id || '').trim();
  let sheetKey = String(payload.sheetKey || '').trim();
  let rowIdx = Number(payload.sheetRowIndex || 0);

  if (!sheetKey && recordId) {
    const m = recordId.match(/^(mkt|booked|arrived)-row-(\d+)$/);
    if (m) {
      sheetKey = m[1];
      if (!rowIdx) rowIdx = Number(m[2]);
    }
  }
  if (!sheetKey) sheetKey = 'mkt';

  if (!SHEETS_CONFIG[sheetKey]) {
    throw new Error(`Sheet không hợp lệ: ${sheetKey}`);
  }

  const targetRec = rowIdx >= 2 ? findRecordInSheet(sheetKey, rowIdx) : null;
  const effectivePhone = normalizePhone(payload.phone || targetRec?.phone || '');
  const effectiveName = String(payload.name || targetRec?.name || '').trim();
  const effectiveDataDate = String(targetRec?.dataDate || '').trim();

  if (!rowIdx && !effectivePhone && !effectiveName) {
    throw new Error('Không xác định được khách hàng cần xóa');
  }

  if (!Array.isArray(localState.deletedRecords)) {
    localState.deletedRecords = [];
  }

  const removeFromSingleSheetLocal = (targetKey, matchFn, fallbackRow = 0) => {
    const removedRows = [];

    if (Array.isArray(localState.addedRecords[targetKey])) {
      localState.addedRecords[targetKey] = localState.addedRecords[targetKey].filter((rec) => {
        if (matchFn(rec)) {
          removedRows.push(rec.sheetRowIndex);
          return false;
        }
        return true;
      });
    }

    if (Array.isArray(memoryCache.sheets?.[targetKey]?.records)) {
      memoryCache.sheets[targetKey].records = memoryCache.sheets[targetKey].records.filter(
        (rec) => {
          if (matchFn(rec)) {
            removedRows.push(rec.sheetRowIndex);
            return false;
          }
          return true;
        }
      );
    }

    if (fallbackRow >= 2 && !removedRows.includes(fallbackRow)) {
      removedRows.push(fallbackRow);
    }

    for (const rIdx of removedRows) {
      delete localState.rowOverrides[`${targetKey}:${rIdx}`];
    }

    localState.deletedRecords.push({
      sheetKey: targetKey,
      sheetRowIndex: removedRows[0] || fallbackRow || 0,
      phone: effectivePhone,
      name: effectiveName,
      dataDate: effectiveDataDate,
      deletedAt: new Date().toISOString(),
    });
  };

  removeFromSingleSheetLocal(
    sheetKey,
    (rec) => {
      if (recordId && rec.id === recordId) return true;
      if (rowIdx >= 2 && rec.sheetRowIndex === rowIdx) return true;
      if (
        !rowIdx &&
        effectivePhone &&
        normalizePhone(rec.phone) === effectivePhone &&
        (!effectiveName ||
          String(rec.name || '').trim().toLowerCase() === effectiveName.toLowerCase())
      ) {
        return true;
      }
      return false;
    },
    rowIdx
  );

  // Nếu xóa ở Sheet 1 (DATA NGUỒN MKT) và không còn dòng nào trùng SĐT này ở MKT,
  // tự động dọn luôn bản ghi đã đồng bộ bên Sheet 2 (KHÁCH ĐẶT HẸN) và Sheet 3 (KHÁCH ĐÃ ĐẾN)
  let alsoCleanLinkedSheets = false;
  if (sheetKey === 'mkt' && effectivePhone && payload.deleteSynced !== false) {
    const remainingMktBase = (memoryCache.sheets?.mkt?.records || []).filter(
      (r) => !isRecordDeletedInLocalState('mkt', r, localState)
    );
    const remainingMktAdded = (localState.addedRecords.mkt || []).filter(
      (r) => !isRecordDeletedInLocalState('mkt', r, localState)
    );
    const stillHasSamePhoneInMkt = [...remainingMktBase, ...remainingMktAdded].some(
      (r) => normalizePhone(r.phone) === effectivePhone
    );

    if (!stillHasSamePhoneInMkt) {
      alsoCleanLinkedSheets = true;
      for (const linkedKey of ['booked', 'arrived']) {
        removeFromSingleSheetLocal(
          linkedKey,
          (rec) => normalizePhone(rec.phone) === effectivePhone
        );
      }
      if (localState.revenueByPhone && localState.revenueByPhone[effectivePhone] !== undefined) {
        delete localState.revenueByPhone[effectivePhone];
      }
    }
  }

  saveLocalState(localState);

  let syncedSheet = false;
  if (!process.env.NODE_TEST_CONTEXT) {
    try {
      const apiDeleted = await deleteRowFromSheetViaApi(sheetKey, {
        rowIdx,
        phone: effectivePhone,
        name: effectiveName,
      });
      if (alsoCleanLinkedSheets && effectivePhone) {
        await Promise.all([
          deleteRowFromSheetViaApi('booked', { phone: effectivePhone, name: effectiveName }),
          deleteRowFromSheetViaApi('arrived', { phone: effectivePhone, name: effectiveName }),
        ]);
      }
      if (apiDeleted) {
        syncedSheet = true;
      } else {
        const gasRes = await postToAppsScript({
          action: 'deleteLead',
          sheetKey,
          sheetName: SHEETS_CONFIG[sheetKey].name,
          sheetRowIndex: rowIdx,
          phone: effectivePhone,
          name: effectiveName,
          deleteSynced: alsoCleanLinkedSheets,
        });
        syncedSheet = Boolean(gasRes?.synced);
      }
    } catch {
      syncedSheet = false;
    }
  }

  return {
    ok: true,
    deleted: {
      recordId: recordId || `${sheetKey}-row-${rowIdx}`,
      sheetKey,
      sheetRowIndex: rowIdx,
      name: effectiveName,
      phone: effectivePhone,
    },
    syncedSheet,
  };
}


