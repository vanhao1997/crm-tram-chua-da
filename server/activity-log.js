import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SHEETS_CONFIG } from './config.js';

const DATA_DIR = path.join(ROOT_DIR, 'server', 'data');
const LOGS_FILE = path.join(DATA_DIR, 'activity-logs.json');
const MAX_LOG_ENTRIES = 2000;

let memoryLogs = null;
let logSeq = 1;
let persistTimer = null;

function formatVnDateTime(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(safeDate);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.day || '01'}/${map.month || '01'}/${map.year || '2026'} ${map.hour || '00'}:${
    map.minute || '00'
  }:${map.second || '00'}`;
}

function sanitizeLogText(text = '') {
  return String(text || '')
    .replace(/\s*\(Cột\s+[A-Z0-9,\s+]+\)/gi, '')
    .replace(/\bCột\s+[A-Z0-9]+\b/gi, '')
    .replace(/\bGhi chú M\b/g, 'Ghi chú Lần 1')
    .replace(/\s*\(Dòng\s*#\d+\)/gi, '')
    .replace(/\bKhách(?:\s+hàng)?\s+dòng\s*#\d+/gi, 'Khách hàng')
    .replace(/CRM\s*&\s*Google Sheet/gi, 'hệ thống CRM')
    .replace(/\bGoogle Sheet\b/gi, 'hệ thống')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ...entry,
    actionLabel: sanitizeLogText(entry.actionLabel),
    summary: sanitizeLogText(entry.summary),
    target: entry.target
      ? {
          ...entry.target,
          customerName: sanitizeLogText(entry.target.customerName),
        }
      : entry.target,
    changes: Array.isArray(entry.changes)
      ? entry.changes.map((c) => ({
          ...c,
          label: sanitizeLogText(c.label),
          before: sanitizeLogText(c.before),
          after: sanitizeLogText(c.after),
        }))
      : [],
  };
}

function ensureLogsLoaded() {
  if (Array.isArray(memoryLogs)) {
    return memoryLogs;
  }
  try {
    if (fs.existsSync(LOGS_FILE)) {
      const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryLogs = parsed.slice(0, MAX_LOG_ENTRIES).map(sanitizeLogEntry);
        return memoryLogs;
      }
    }
  } catch {
    // Fallback to empty array if file is missing or corrupted
  }
  memoryLogs = [];
  return memoryLogs;
}

function flushLogsToDisk() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LOGS_FILE, JSON.stringify(memoryLogs || [], null, 2), 'utf-8');
  } catch (err) {
    console.warn('Không thể lưu activity-logs.json:', err.message);
  }
}

function scheduleLogsPersist() {
  if (process.env.NODE_TEST_CONTEXT) {
    flushLogsToDisk();
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(flushLogsToDisk, 150);
  if (typeof persistTimer.unref === 'function') {
    persistTimer.unref();
  }
}

export function normalizeActor(user) {
  if (!user || typeof user !== 'object') {
    return {
      id: 'system',
      username: 'admin',
      telesaleName: 'ADMIN',
      role: 'admin',
    };
  }
  const role = user.role === 'admin' ? 'admin' : 'telesale';
  const username = String(user.username || (role === 'admin' ? 'admin' : 'telesale'))
    .trim()
    .toLowerCase();
  const telesaleName = String(
    user.telesaleName || (role === 'admin' ? 'ADMIN' : username.toUpperCase())
  )
    .trim()
    .toUpperCase();
  return {
    id: String(user.id || username),
    username,
    telesaleName,
    role,
  };
}

export function getSheetShortLabel(sheetKey) {
  if (!sheetKey) return '';
  return SHEETS_CONFIG[sheetKey]?.shortName || SHEETS_CONFIG[sheetKey]?.name || String(sheetKey);
}

/**
 * Ghi nhận một thao tác của User hoặc Admin vào Nhật ký hệ thống
 */
export function recordActivityLog({
  actor,
  actionType = 'interaction',
  actionLabel = 'Cập nhật dữ liệu',
  target = {},
  summary = '',
  changes = [],
  createdAt = null,
} = {}) {
  const logs = ensureLogsLoaded();
  const nowIso = createdAt || new Date().toISOString();
  const normalizedActor = normalizeActor(actor);
  const sheetKey = String(target.sheetKey || '').trim();

  const entry = sanitizeLogEntry({
    id: `log-${Date.now()}-${logSeq++}`,
    createdAt: nowIso,
    timeVn: formatVnDateTime(nowIso),
    actor: normalizedActor,
    actionType: String(actionType || 'interaction').trim(),
    actionLabel: String(actionLabel || 'Thao tác hệ thống').trim(),
    target: {
      recordId: String(target.recordId || '').trim(),
      sheetKey,
      sheetName: target.sheetName || getSheetShortLabel(sheetKey),
      sheetRowIndex: Number(target.sheetRowIndex || 0) || 0,
      customerName: String(target.customerName || '').trim(),
      customerPhone: String(target.customerPhone || '').trim(),
    },
    summary: String(summary || '').trim(),
    changes: Array.isArray(changes)
      ? changes.map((c) => ({
          field: String(c.field || ''),
          label: String(c.label || c.field || ''),
          before: String(c.before ?? '—'),
          after: String(c.after ?? '—'),
        }))
      : [],
  });

  logs.unshift(entry);
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.length = MAX_LOG_ENTRIES;
  }

  scheduleLogsPersist();
  return entry;
}

/**
 * Khởi tạo dữ liệu lịch sử ban đầu từ local-state nếu file activity-logs.json đang trống
 */
export function seedInitialLogsFromLocalState(localState) {
  const logs = ensureLogsLoaded();
  if (logs.length > 0 || !localState) return;

  const seeded = [];

  // 1. Các bản ghi khách hàng do Admin thêm mới
  for (const sheetKey of ['mkt', 'booked', 'arrived']) {
    const addedList = localState.addedRecords?.[sheetKey] || [];
    for (const rec of addedList) {
      if (sheetKey !== 'mkt') continue;
      seeded.push({
        id: `seed-add-${sheetKey}-${rec.sheetRowIndex}`,
        createdAt: new Date().toISOString(),
        timeVn: `${rec.dataDate || '15/10/2026'} 09:00:00`,
        actor: {
          id: 'admin-1',
          username: 'admin',
          telesaleName: 'ADMIN',
          role: 'admin',
        },
        actionType: 'add_lead',
        actionLabel: 'Thêm khách mới',
        target: {
          recordId: rec.id || `${sheetKey}-row-${rec.sheetRowIndex}`,
          sheetKey,
          sheetName: getSheetShortLabel(sheetKey),
          sheetRowIndex: Number(rec.sheetRowIndex || 0),
          customerName: String(rec.name || 'Khách hàng'),
          customerPhone: String(rec.phone || ''),
        },
        summary: `Thêm Data khách mới: ${rec.name || 'Khách hàng'} (${rec.phone || '—'})${
          rec.service ? ` · Dịch vụ: ${rec.service}` : ''
        }`,
        changes: [
          ...(rec.status ? [{ field: 'status', label: 'Tình trạng', before: '—', after: rec.status }] : []),
          ...(rec.telesale ? [{ field: 'telesale', label: 'Telesale', before: '—', after: rec.telesale }] : []),
        ],
      });
    }
  }

  // 2. Các dòng đã cập nhật trong rowOverrides
  const overrides = localState.rowOverrides || {};
  for (const [key, ov] of Object.entries(overrides)) {
    if (!ov || typeof ov !== 'object') continue;
    const [sheetKey, rowStr] = key.split(':');
    const rowIdx = Number(rowStr || 0);
    const updatedIso = ov.updatedAt || new Date().toISOString();
    const staffName = String(ov.telesale || '').trim().toUpperCase();
    const isStaff = Boolean(staffName && staffName !== 'ADMIN');
    const changes = [];

    if (ov.status) {
      changes.push({ field: 'status', label: 'Tình trạng', before: 'Trước đó', after: ov.status });
    }
    if (ov.apptDate || ov.apptTime) {
      changes.push({
        field: 'appointment',
        label: 'Lịch hẹn',
        before: '—',
        after: `${ov.apptDate || '—'}${ov.apptTime ? ` (${ov.apptTime})` : ''}`,
      });
    }
    if (ov.noteM) {
      changes.push({ field: 'noteM', label: 'Ghi chú Lần 1', before: '—', after: ov.noteM });
    }

    if (changes.length === 0) continue;

    seeded.push({
      id: `seed-ov-${sheetKey}-${rowIdx}`,
      createdAt: updatedIso,
      timeVn: formatVnDateTime(updatedIso),
      actor: {
        id: isStaff ? `sale-${staffName.toLowerCase()}` : 'admin-1',
        username: isStaff ? staffName.toLowerCase() : 'admin',
        telesaleName: isStaff ? staffName : 'ADMIN',
        role: isStaff ? 'telesale' : 'admin',
      },
      actionType: ov.status ? 'update_status' : 'update_note',
      actionLabel: ov.status ? 'Cập nhật tình trạng' : 'Cập nhật ghi chú',
      target: {
        recordId: `${sheetKey}-row-${rowIdx}`,
        sheetKey,
        sheetName: getSheetShortLabel(sheetKey),
        sheetRowIndex: rowIdx,
        customerName: 'Khách hàng',
        customerPhone: '',
      },
      summary: changes.map((c) => `${c.label}: ${c.after}`).join(' · '),
      changes,
    });
  }

  if (seeded.length > 0) {
    seeded.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    memoryLogs.push(...seeded.slice(0, MAX_LOG_ENTRIES));
    scheduleLogsPersist();
  }
}

/**
 * Lấy danh sách Nhật ký thao tác cho Admin kèm bộ lọc
 */
export function listActivityLogs({
  actor = 'all',
  actionType = 'all',
  search = '',
  limit = 300,
} = {}) {
  const logs = ensureLogsLoaded();
  const actorFilter = String(actor || 'all').trim().toUpperCase();
  const typeFilter = String(actionType || 'all').trim().toLowerCase();
  const q = String(search || '').trim().toLowerCase();
  const maxItems = Math.min(1000, Math.max(1, Number(limit) || 300));

  const filtered = logs.filter((item) => {
    if (actorFilter !== 'ALL') {
      if (actorFilter === 'ROLE:ADMIN') {
        if (item.actor?.role !== 'admin') return false;
      } else if (actorFilter === 'ROLE:TELESALE') {
        if (item.actor?.role !== 'telesale') return false;
      } else {
        const matchUsername = String(item.actor?.username || '').toUpperCase() === actorFilter;
        const matchTelesale = String(item.actor?.telesaleName || '').toUpperCase() === actorFilter;
        if (!matchUsername && !matchTelesale) return false;
      }
    }

    if (typeFilter !== 'all') {
      if (typeFilter === 'note') {
        if (item.actionType !== 'add_note' && item.actionType !== 'update_note') return false;
      } else if (typeFilter === 'lead') {
        if (item.actionType !== 'add_lead' && item.actionType !== 'delete_lead') return false;
      } else if (typeFilter === 'system') {
        if (
          ![
            'auth_login',
            'user_management',
            'send_telegram',
            'update_telegram_schedule',
          ].includes(item.actionType)
        ) {
          return false;
        }
      } else if (String(item.actionType || '').toLowerCase() !== typeFilter) {
        return false;
      }
    }

    if (q) {
      const hay = [
        item.actor?.username,
        item.actor?.telesaleName,
        item.actionLabel,
        item.target?.customerName,
        item.target?.customerPhone,
        item.target?.sheetName,
        item.summary,
        ...(item.changes || []).map((c) => `${c.label} ${c.before} ${c.after}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  const vnTodayPrefix = formatVnDateTime(new Date()).slice(0, 10);
  const stats = {
    total: logs.length,
    filteredCount: filtered.length,
    todayCount: logs.filter((l) => String(l.timeVn || '').startsWith(vnTodayPrefix)).length,
    adminCount: logs.filter((l) => l.actor?.role === 'admin').length,
    telesaleCount: logs.filter((l) => l.actor?.role === 'telesale').length,
  };

  return {
    logs: filtered.slice(0, maxItems),
    stats,
  };
}
