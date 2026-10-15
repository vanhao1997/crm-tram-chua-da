import {
  fetchCrmData,
  saveCustomerInteraction,
  createAdminLead,
  deleteCustomerLead,
  triggerTelegramReminder,
  loginUser,
  logoutUser,
  fetchCurrentUser,
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  fetchAdminOverview,
  fetchTelegramSchedule,
  updateTelegramSchedule,
} from './core/api.js';
import { escapeHtml, vnDateToIso, isoToVnDate, getLocalIsoDate } from './core/utils.js';

const state = {
  currentUser: null,
  authChecking: true,
  loginError: '',
  loginLoading: false,
  showLoginPassword: false,
  crmData: null,
  loading: true,
  refreshing: false,
  activeTab: 'mkt', // 'mkt' | 'booked' | 'arrived' | 'today' | 'overview' | 'admin'
  viewMode: 'grid', // 'grid' (Airtable Grid) | 'kanban' (Airtable Sales Pipeline Kanban)
  groupBy: 'none', // 'none' | 'status' | 'telesale'
  reminderRange: 'today', // 'today' | 'tomorrow' | 'upcoming' | 'custom'
  reminderCustomDate: '',
  adminUsers: [],
  adminLoading: false,
  editingUserId: null,
  telegramSchedule: {
    enabled: true,
    sendTime: '08:00',
    lastSentDate: '',
    lastSentTime: '',
  },
  adminOverview: null,
  overviewLoading: false,
  overviewPeriod: 'month', // 'today' | 'week' | 'month' | 'lastmonth' | 'all' | 'custom'
  overviewCustomFrom: '',
  overviewCustomTo: '',
  filters: {
    search: '',
    telesale: 'all',
    status: 'all',
    monthKey: 'current',
  },
  pagination: {
    page: 1,
    pageSize: 30,
  },
  editingRecordId: null,
  addLeadModalOpen: false,
  arrivedModal: null, // { recordId, status }
  activeCareInputId: null,
  toasts: [],
};

let searchDebounceTimer = null;
const apptSummaryCache = new WeakMap();
const contactLogsCache = new WeakMap();

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

function getCurrentMonthKey(records = []) {
  const now = new Date();
  const sysMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const available = Array.from(new Set(records.map((r) => r.monthKey).filter(Boolean)));
  if (available.includes(sysMonth)) {
    return sysMonth;
  }
  return available[0] || sysMonth;
}

function resolveEffectiveMonthKey(records = [], requestedMonthKey = 'current') {
  if (!requestedMonthKey || requestedMonthKey === 'current') {
    return getCurrentMonthKey(records);
  }
  if (requestedMonthKey === 'all') {
    return 'all';
  }
  const available = Array.from(new Set(records.map((r) => r.monthKey).filter(Boolean)));
  if (available.length > 0 && !available.includes(requestedMonthKey)) {
    return getCurrentMonthKey(records);
  }
  return requestedMonthKey;
}

function notify(msg) {
  const id = Date.now() + Math.random();
  state.toasts.push({ id, msg });
  renderToasts();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    renderToasts();
  }, 2200);
}

function renderToasts() {
  let el = document.getElementById('toast-wrap');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-wrap';
    el.className = 'toast-wrap';
    document.body.appendChild(el);
  }
  el.innerHTML = state.toasts.map((t) => `<div class="toast">${escapeHtml(t.msg)}</div>`).join('');
}

export function getAppointmentSummary(crmData, baseDate = new Date()) {
  const todayIso = getLocalIsoDate(0, baseDate);
  if (crmData && typeof crmData === 'object') {
    const cached = apptSummaryCache.get(crmData);
    if (cached && cached.todayIso === todayIso) {
      return cached.summary;
    }
  }

  const tomorrowIso = getLocalIsoDate(1, baseDate);
  const next7Iso = getLocalIsoDate(7, baseDate);

  const booked = crmData?.sheets?.booked?.records || [];
  const mkt = crmData?.sheets?.mkt?.records || [];

  const allAppts = [];
  const seenKeys = new Set();

  for (const r of booked) {
    const iso = vnDateToIso(r.apptDate);
    if (!iso) continue;
    const dedupeKey = `${r.phone || r.name || r.id}:${iso}`;
    seenKeys.add(dedupeKey);
    allAppts.push({ ...r, _apptIso: iso });
  }

  for (const r of mkt) {
    const iso = vnDateToIso(r.apptDate);
    if (!iso) continue;
    const dedupeKey = `${r.phone || r.name || r.id}:${iso}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    allAppts.push({ ...r, _apptIso: iso });
  }

  const statusPriority = (rec) => {
    const canon = String(rec.canonicalStatus || rec.status || '').toUpperCase();
    if (canon === 'ĐẶT HẸN') return 1;
    if (rec.statusGroup === 'new' || rec.statusGroup === 'followup') return 2;
    if (canon === 'DỜI LỊCH' || rec.statusGroup === 'unreachable') return 3;
    if (rec.statusGroup === 'arrived') return 4;
    return 5;
  };

  allAppts.sort((a, b) => {
    if (a._apptIso !== b._apptIso) return a._apptIso.localeCompare(b._apptIso);
    const pa = statusPriority(a);
    const pb = statusPriority(b);
    if (pa !== pb) return pa - pb;
    return b.sheetRowIndex - a.sheetRowIndex;
  });

  const todayList = allAppts.filter((r) => r._apptIso === todayIso);
  const tomorrowList = allAppts.filter((r) => r._apptIso === tomorrowIso);
  const upcomingList = allAppts.filter((r) => r._apptIso >= todayIso && r._apptIso <= next7Iso);

  const isNeedCall = (r) => {
    const canon = String(r.canonicalStatus || r.status || '').toUpperCase();
    return canon !== 'HỦY LỊCH' && canon !== 'ĐÃ ĐẾN' && r.statusGroup !== 'lost' && r.statusGroup !== 'arrived';
  };

  const todayNeedCallCount = todayList.filter(isNeedCall).length;
  const tomorrowNeedCallCount = tomorrowList.filter(isNeedCall).length;

  const summary = {
    todayIso,
    tomorrowIso,
    next7Iso,
    todayVn: isoToVnDate(todayIso),
    tomorrowVn: isoToVnDate(tomorrowIso),
    allAppts,
    todayList,
    tomorrowList,
    upcomingList,
    todayNeedCallCount,
    tomorrowNeedCallCount,
  };

  if (crmData && typeof crmData === 'object') {
    apptSummaryCache.set(crmData, { todayIso, summary });
  }

  return summary;
}

function getActiveRecords() {
  if (state.activeTab === 'today') {
    const summary = getAppointmentSummary(state.crmData);
    if (state.reminderRange === 'tomorrow') return summary.tomorrowList;
    if (state.reminderRange === 'upcoming') return summary.upcomingList;
    if (state.reminderRange === 'custom' && state.reminderCustomDate) {
      return summary.allAppts.filter((r) => r._apptIso === state.reminderCustomDate);
    }
    return summary.todayList;
  }
  return state.crmData?.sheets?.[state.activeTab]?.records || [];
}

function getFilteredRecords() {
  const records = getActiveRecords();
  const { search, telesale, status, monthKey } = state.filters;
  const effectiveMonth = resolveEffectiveMonthKey(records, monthKey);
  const q = search.trim().toLowerCase();
  const qDigits = search.replace(/\D/g, '');

  return records.filter((r) => {
    if (telesale === 'UNASSIGNED') {
      if (r.telesale) return false;
    } else if (telesale !== 'all') {
      if ((r.telesale || '').toUpperCase() !== telesale.toUpperCase()) return false;
    }

    if (status === 'NEW') {
      if (r.statusGroup !== 'new') return false;
    } else if (status !== 'all') {
      if (
        (r.canonicalStatus || '').toUpperCase() !== status.toUpperCase() &&
        (r.status || '').toUpperCase() !== status.toUpperCase()
      ) {
        return false;
      }
    }

    if (
      state.activeTab !== 'today' &&
      effectiveMonth !== 'all' &&
      r.monthKey !== effectiveMonth &&
      r.section !== effectiveMonth
    ) {
      return false;
    }

    if (q) {
      const careTexts = Array.isArray(r.careHistory)
        ? r.careHistory.map((c) => c?.text || '').join(' ')
        : '';
      const text = [
        r.name,
        r.phone,
        r.customerInfo,
        r.service,
        r.noteM,
        careTexts,
        r.telesale,
        r.apptDate,
      ]
        .join(' ')
        .toLowerCase();
      const matchPhone = qDigits.length >= 3 && (r.phone || '').includes(qDigits);
      if (!text.includes(q) && !matchPhone) return false;
    }

    return true;
  });
}

function findRecord(id) {
  if (!state.crmData || !id) return null;
  for (const k of ['mkt', 'booked', 'arrived']) {
    const found = state.crmData.sheets[k]?.records?.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

export function isArrivedStatusValue(val) {
  const upper = String(val || '')
    .normalize('NFC')
    .trim()
    .toUpperCase();
  return upper === 'ĐÃ ĐẾN' || upper.includes('ĐẾN VÀ VỀ');
}

function renderStatusSelectOptions(rec, statusOptions = [], isAdmin = false) {
  const options = Array.isArray(statusOptions) ? statusOptions : [];
  const curCanon = String(rec?.canonicalStatus || '')
    .normalize('NFC')
    .trim()
    .toUpperCase();
  const curRaw = String(rec?.status || '')
    .normalize('NFC')
    .trim()
    .toUpperCase();
  let hasMatch = false;

  let html = options
    .map((opt) => {
      const optUpper = String(opt.value || '')
        .normalize('NFC')
        .trim()
        .toUpperCase();
      const selected =
        (opt.value === '' && rec?.statusGroup === 'new') ||
        (opt.value !== '' && (optUpper === curCanon || optUpper === curRaw));
      const isAdminOnlyOpt =
        Boolean(opt.adminOnly) || opt.group === 'arrived' || isArrivedStatusValue(opt.value);

      if (!isAdmin && isAdminOnlyOpt) {
        if (selected) {
          hasMatch = true;
          return `<option value="${escapeHtml(opt.value)}" selected disabled>${escapeHtml(
            opt.label
          )} (Chỉ Admin)</option>`;
        }
        return '';
      }

      if (selected) hasMatch = true;
      return `<option value="${escapeHtml(opt.value)}" ${selected ? 'selected' : ''}>${escapeHtml(
        opt.label
      )}</option>`;
    })
    .join('');

  if (!hasMatch && rec?.status && rec?.statusGroup !== 'new') {
    html += `<option value="${escapeHtml(rec.status)}" selected>${escapeHtml(
      rec.statusLabel || rec.status
    )}</option>`;
  }
  return html;
}

function renderTelesaleSelectOptions(currentTelesale, telesaleList = []) {
  const list = Array.isArray(telesaleList) ? telesaleList : [];
  const cur = String(currentTelesale || '')
    .normalize('NFC')
    .trim()
    .toUpperCase();
  const inList = list.some(
    (s) =>
      String(s || '')
        .normalize('NFC')
        .trim()
        .toUpperCase() === cur
  );

  let html = `<option value="" ${!cur ? 'selected' : ''}>Chưa phân bổ</option>`;
  html += list
    .map((name) => {
      const upper = String(name || '')
        .normalize('NFC')
        .trim()
        .toUpperCase();
      return `<option value="${escapeHtml(upper)}" ${
        upper === cur ? 'selected' : ''
      }>${escapeHtml(upper)}</option>`;
    })
    .join('');

  if (cur && !inList) {
    html += `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)}</option>`;
  }
  return html;
}

export function renderLoginScreen(loginState = {}) {
  const { loginError = '', loginLoading = false, showLoginPassword = false } = loginState;
  return `
    <div class="login-shell">
      <div class="login-card">
        <div class="login-brand">
          <img
            src="/brandmark.webp"
            onerror="this.onerror=null;this.src='https://crm-bsn.vibecodingsolution.ovh/brandmark.webp'"
            alt="Trạm Chữa Da BSN"
            class="login-logo"
            width="52"
            height="52"
          />
          <h1 class="login-title">Trạm Chữa Da BSN</h1>
          <p class="login-subtitle">Hệ thống CRM nội bộ — Vui lòng đăng nhập tài khoản được cấp quyền</p>
        </div>

        ${
          loginError
            ? `<div class="login-error-alert" role="alert">${escapeHtml(loginError)}</div>`
            : ''
        }

        <form id="login-form" class="login-form" autocomplete="on">
          <div class="form-group">
            <label for="login-username">Tên đăng nhập (User)</label>
            <input
              type="text"
              id="login-username"
              name="username"
              class="modal-input"
              placeholder="Ví dụ: thinh, phu, admin..."
              autocomplete="username"
              required
            />
          </div>

          <div class="form-group">
            <label for="login-password">Mật khẩu (Pass)</label>
            <div class="password-input-wrap">
              <input
                type="${showLoginPassword ? 'text' : 'password'}"
                id="login-password"
                name="password"
                class="modal-input"
                placeholder="Nhập mật khẩu được cấp..."
                autocomplete="current-password"
                required
              />
              <button
                type="button"
                class="btn-toggle-pass"
                id="btn-toggle-login-pass"
                title="${showLoginPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}"
              >
                ${showLoginPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            class="btn-clean btn-primary-clean login-submit-btn"
            id="btn-login-submit"
            ${loginLoading ? 'disabled' : ''}
          >
            ${loginLoading ? 'Đang xác thực...' : 'Đăng nhập vào CRM'}
          </button>
        </form>

        <div class="login-footer-note">
          Chỉ nhân sự được Admin cấp quyền mới có thể truy cập dữ liệu khách hàng.
        </div>
      </div>
    </div>
  `;
}

export function renderAdminView(
  adminUsers = [],
  editingUserId = null,
  currentAdminId = '',
  telegramSchedule = null
) {
  const users = Array.isArray(adminUsers) ? adminUsers : [];
  const editingUser = editingUserId ? users.find((u) => u.id === editingUserId) : null;

  const activeTelesalesCount = users.filter(
    (u) => u.role === 'telesale' && u.active && u.permissions?.accessCrm !== false
  ).length;
  const lockedCount = users.filter((u) => !u.active || u.permissions?.accessCrm === false).length;

  const formRole = editingUser ? editingUser.role : 'telesale';
  const formScope = editingUser?.permissions?.dataScope || 'all';
  const formCanEdit = editingUser ? editingUser.permissions?.canEdit !== false : true;
  const formActive = editingUser ? Boolean(editingUser.active) : true;

  const sched = telegramSchedule || state.telegramSchedule || { enabled: true, sendTime: '08:00' };
  const teleEnabled = sched.enabled !== false;
  const teleSendTime = String(sched.sendTime || '08:00').trim() || '08:00';
  const teleLastSentDate = String(sched.lastSentDate || '').trim();
  const teleLastSentTime = String(sched.lastSentTime || '').trim();

  return `
    <div class="admin-panel">
      <div class="admin-stats-bar">
        <div class="admin-stat-card">
          <span class="admin-stat-label">Tổng tài khoản</span>
          <strong class="admin-stat-value">${users.length}</strong>
        </div>
        <div class="admin-stat-card">
          <span class="admin-stat-label">Telesale đang cấp quyền (Cột L)</span>
          <strong class="admin-stat-value is-emerald">${activeTelesalesCount}</strong>
        </div>
        <div class="admin-stat-card">
          <span class="admin-stat-label">Tài khoản đang khóa</span>
          <strong class="admin-stat-value ${lockedCount > 0 ? 'is-rose' : ''}">${lockedCount}</strong>
        </div>
        <div class="admin-stat-card">
          <span class="admin-stat-label">Tự động báo lịch Telegram</span>
          <strong class="admin-stat-value ${teleEnabled ? 'is-emerald' : 'is-rose'}">
            ${teleEnabled ? `BẬT (${escapeHtml(teleSendTime)})` : 'ĐANG TẮT'}
          </strong>
        </div>
      </div>

      <!-- PHẦN QUẢN TRỊ TỰ ĐỘNG BÁO LỊCH QUA TELEGRAM (CHỈ ADMIN) -->
      <div class="sheet-card admin-tele-schedule-card" id="admin-tele-schedule-card">
        <div class="admin-section-header">
          <div>
            <h2 class="admin-section-title">🤖 Quản Trị Tự Động Báo Lịch Hẹn Qua Telegram</h2>
            <p class="admin-section-desc">
              Bật / Tắt chế độ tự động báo lịch và cài đặt giờ gửi hàng ngày cho Bot Telegram (Nhóm: <strong>BSN - TELE BÁO KHÁCH</strong>).
            </p>
          </div>
          <div class="tele-schedule-status-badge ${teleEnabled ? 'is-enabled' : 'is-disabled'}">
            <span class="tele-status-dot"></span>
            <span>${
              teleEnabled
                ? `Đang BẬT · Tự động gửi lúc ${escapeHtml(teleSendTime)} mỗi ngày`
                : 'Đang TẮT tự động gửi lịch hẹn'
            }</span>
          </div>
        </div>

        <div class="tele-schedule-controls-grid">
          <div class="tele-control-box">
            <label class="tele-control-label">1. Trạng thái Tự động báo lịch (Bật / Tắt)</label>
            <div class="tele-toggle-row">
              <button
                type="button"
                class="tele-switch-btn ${teleEnabled ? 'is-on' : 'is-off'}"
                id="btn-toggle-tele-auto"
                data-tele-enabled="${teleEnabled ? 'true' : 'false'}"
              >
                <span class="tele-switch-track">
                  <span class="tele-switch-knob"></span>
                </span>
                <span class="tele-switch-text">
                  ${teleEnabled ? '🟢 Đang BẬT tự động báo lịch' : '⚪ Đang TẮT tự động báo lịch'}
                </span>
              </button>
            </div>
            <span class="tele-control-hint">
              Bấm nút gạt để Bật hoặc Tắt chế độ Bot tự động gửi danh sách lịch hẹn mỗi ngày.
            </span>
          </div>

          <div class="tele-control-box">
            <label class="tele-control-label" for="admin-tele-send-time">
              2. Cài đặt giờ gửi tự động cho Bot (Giờ Việt Nam GMT+7)
            </label>
            <div class="tele-time-input-row">
              <input
                type="time"
                id="admin-tele-send-time"
                class="modal-input tele-time-input"
                value="${escapeHtml(teleSendTime)}"
              />
              <button
                type="button"
                class="btn-clean btn-primary-clean"
                id="btn-save-tele-schedule"
              >
                💾 Lưu cài đặt giờ
              </button>
            </div>
            <div class="tele-time-presets">
              <span class="preset-label">Chọn nhanh:</span>
              ${['07:00', '07:30', '08:00', '08:30', '09:00', '12:00', '20:00']
                .map(
                  (t) => `
                  <button
                    type="button"
                    class="tele-preset-chip ${teleSendTime === t ? 'active' : ''}"
                    data-tele-preset="${t}"
                  >${t}</button>
                `
                )
                .join('')}
            </div>
          </div>

          <div class="tele-control-box">
            <label class="tele-control-label">3. Bắn báo cáo thủ công ngay lập tức</label>
            <div class="tele-manual-btns">
              <button
                type="button"
                class="btn-reminder-action is-telegram-btn"
                data-send-telegram="today"
              >
                📨 Gửi lịch Hôm nay ngay
              </button>
              <button
                type="button"
                class="btn-reminder-action"
                data-send-telegram="tomorrow"
              >
                📅 Gửi lịch Ngày mai
              </button>
            </div>
            <span class="tele-control-hint">
              ${
                teleLastSentDate
                  ? `✅ Tự động gửi gần nhất: <strong>${escapeHtml(
                      teleLastSentTime || teleSendTime
                    )} ngày ${escapeHtml(teleLastSentDate)}</strong>`
                  : `ℹ️ Hôm nay chưa tới giờ tự động gửi (Hẹn lúc <strong>${escapeHtml(
                      teleSendTime
                    )}</strong>).`
              }
            </span>
          </div>
        </div>
      </div>

      <div class="sheet-card admin-form-card">
        <div class="admin-section-header">
          <div>
            <h2 class="admin-section-title">
              ${
                editingUser
                  ? `Chỉnh sửa tài khoản: ${escapeHtml(editingUser.username)}`
                  : 'Cấp Tài Khoản Mới & Phân Quyền Vào CRM'
              }
            </h2>
            <p class="admin-section-desc">
              Đặt User, Pass, Tên Telesale (tự động đồng bộ vào Cột L trên bảng CRM & Google Sheet) và cấp quyền truy cập.
            </p>
          </div>
          ${
            editingUser
              ? `<button type="button" class="btn-clean" id="btn-cancel-edit-user">Hủy chỉnh sửa</button>`
              : ''
          }
        </div>

        <form id="admin-user-form" class="admin-user-form">
          <div class="admin-form-grid">
            <div class="form-group">
              <label for="admin-input-username">Tên đăng nhập (User) *</label>
              <input
                type="text"
                id="admin-input-username"
                class="modal-input"
                placeholder="VD: thinh, phu, ngoc..."
                value="${escapeHtml(editingUser ? editingUser.username : '')}"
                required
              />
            </div>

            <div class="form-group">
              <label for="admin-input-password">
                ${editingUser ? 'Mật khẩu (Pass - sửa để đổi mới)' : 'Mật khẩu (Pass) *'}
              </label>
              <div class="password-input-wrap">
                <input
                  type="text"
                  id="admin-input-password"
                  class="modal-input"
                  placeholder="VD: 123456 hoặc bsn2026"
                  value="${escapeHtml(editingUser ? editingUser.passwordDisplay || '' : '123456')}"
                  ${editingUser ? '' : 'required'}
                />
                <button
                  type="button"
                  class="btn-toggle-pass"
                  id="btn-gen-random-pass"
                  title="Tạo mật khẩu ngẫu nhiên 6 ký tự"
                >
                  Tạo nhanh
                </button>
              </div>
            </div>

            <div class="form-group">
              <label for="admin-input-telesale">Tên Telesale (Hiển thị ở Cột L) *</label>
              <input
                type="text"
                id="admin-input-telesale"
                class="modal-input"
                placeholder="VD: THỊNH, PHÚ, LAN..."
                value="${escapeHtml(editingUser ? editingUser.telesaleName : '')}"
                required
              />
            </div>

            <div class="form-group">
              <label for="admin-input-role">Vai trò tài khoản</label>
              <select id="admin-input-role" class="modal-input">
                <option value="telesale" ${formRole === 'telesale' ? 'selected' : ''}>
                  Telesale (Chỉ xem dữ liệu CRM — ẩn trang Quản lý)
                </option>
                <option value="admin" ${formRole === 'admin' ? 'selected' : ''}>
                  Admin (Quản trị viên — toàn quyền)
                </option>
              </select>
            </div>

            <div class="form-group">
              <label for="admin-input-scope">Phạm vi xem dữ liệu CRM</label>
              <select id="admin-input-scope" class="modal-input">
                <option value="all" ${formScope === 'all' ? 'selected' : ''}>
                  Xem tất cả khách hàng trên CRM
                </option>
                <option value="own_and_unassigned" ${formScope === 'own_and_unassigned' ? 'selected' : ''}>
                  Chỉ xem khách của mình + khách chưa gán
                </option>
                <option value="own_only" ${formScope === 'own_only' ? 'selected' : ''}>
                  Chỉ xem khách đã gán tên mình
                </option>
              </select>
            </div>

            <div class="form-group">
              <label for="admin-input-canedit">Quyền thao tác trên CRM</label>
              <select id="admin-input-canedit" class="modal-input">
                <option value="true" ${formCanEdit ? 'selected' : ''}>
                  Cho phép cập nhật (Tình trạng, Lịch hẹn, Ghi chú)
                </option>
                <option value="false" ${!formCanEdit ? 'selected' : ''}>
                  Chỉ xem dữ liệu (Không được sửa)
                </option>
              </select>
            </div>

            <div class="form-group">
              <label for="admin-input-active">Trạng thái cấp quyền vào CRM</label>
              <select id="admin-input-active" class="modal-input">
                <option value="true" ${formActive ? 'selected' : ''}>
                  Đang cấp quyền (Cho phép đăng nhập)
                </option>
                <option value="false" ${!formActive ? 'selected' : ''}>
                  Tạm khóa (Chặn đăng nhập CRM)
                </option>
              </select>
            </div>

            <div class="form-group admin-form-submit-wrap">
              <label>&nbsp;</label>
              <button type="submit" class="btn-clean btn-primary-clean admin-submit-btn" id="btn-save-user">
                ${editingUser ? 'Lưu cập nhật tài khoản' : '+ Cấp tài khoản & Phân quyền'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div class="sheet-card admin-list-card">
        <div class="admin-section-header">
          <div>
            <h2 class="admin-section-title">Danh Sách Tài Khoản & Phân Quyền Nhân Sự</h2>
            <p class="admin-section-desc">
              Bấm <strong>"Copy gửi nhân sự"</strong> để sao chép nhanh thông tin User / Pass gửi cho Telesale.
            </p>
          </div>
        </div>

        <div class="table-wrap">
          <table class="lead-table admin-user-table">
            <thead>
              <tr>
                <th>Tài khoản (User / Pass)</th>
                <th>Tên Telesale (Cột L)</th>
                <th>Vai trò</th>
                <th>Phạm vi dữ liệu</th>
                <th>Quyền thao tác</th>
                <th>Quyền vào CRM</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${users
                .map((u) => {
                  const isSelf = u.id === currentAdminId;
                  const scopeVal = u.permissions?.dataScope || 'all';
                  const canEdit = u.permissions?.canEdit !== false;
                  const isActive = Boolean(u.active && u.permissions?.accessCrm !== false);
                  const copyCredentialText = `CRM Trạm Chữa Da BSN | User: ${u.username} | Pass: ${
                    u.passwordDisplay || '••••••'
                  } | Tên Telesale: ${u.telesaleName}`;

                  return `
                    <tr class="${!isActive ? 'is-locked-user' : ''}">
                      <td>
                        <div class="admin-cred-cell">
                          <div>
                            <span class="cred-label">User:</span>
                            <strong class="cred-user">${escapeHtml(u.username)}</strong>
                          </div>
                          <div>
                            <span class="cred-label">Pass:</span>
                            <code class="cred-pass">${escapeHtml(u.passwordDisplay || '••••••')}</code>
                          </div>
                          <button
                            type="button"
                            class="phone-link cred-copy-btn"
                            data-copy="${escapeHtml(copyCredentialText)}"
                          >
                            Copy gửi nhân sự
                          </button>
                        </div>
                      </td>

                      <td>
                        <span class="telesale-name-badge">${escapeHtml(u.telesaleName || '—')}</span>
                      </td>

                      <td>
                        <span class="role-badge ${u.role === 'admin' ? 'is-admin' : 'is-telesale'}">
                          ${u.role === 'admin' ? 'Admin (Quản lý)' : 'Telesale'}
                        </span>
                      </td>

                      <td>
                        ${
                          u.role === 'admin'
                            ? `<span class="admin-fixed-note">Toàn bộ dữ liệu</span>`
                            : `
                          <select
                            class="clean-select admin-inline-select"
                            data-admin-scope-user="${escapeHtml(u.id)}"
                          >
                            <option value="all" ${scopeVal === 'all' ? 'selected' : ''}>Tất cả khách hàng</option>
                            <option value="own_and_unassigned" ${
                              scopeVal === 'own_and_unassigned' ? 'selected' : ''
                            }>Khách của mình + Chưa gán</option>
                            <option value="own_only" ${
                              scopeVal === 'own_only' ? 'selected' : ''
                            }>Chỉ khách của mình</option>
                          </select>
                        `
                        }
                      </td>

                      <td>
                        ${
                          u.role === 'admin'
                            ? `<span class="admin-fixed-note">Toàn quyền</span>`
                            : `
                          <select
                            class="clean-select admin-inline-select"
                            data-admin-edit-user="${escapeHtml(u.id)}"
                          >
                            <option value="true" ${canEdit ? 'selected' : ''}>Được phép sửa</option>
                            <option value="false" ${!canEdit ? 'selected' : ''}>Chỉ xem</option>
                          </select>
                        `
                        }
                      </td>

                      <td>
                        <button
                          type="button"
                          class="access-pill-btn ${isActive ? 'is-active' : 'is-locked'}"
                          data-admin-toggle-active="${escapeHtml(u.id)}"
                          data-next-active="${isActive ? 'false' : 'true'}"
                          ${isSelf ? 'disabled title="Tài khoản đang đăng nhập"' : ''}
                        >
                          ${isActive ? 'Đang cấp quyền' : 'Đã khóa'}
                        </button>
                      </td>

                      <td>
                        <div class="admin-action-btns">
                          <button
                            type="button"
                            class="btn-clean btn-sm"
                            data-admin-edit-btn="${escapeHtml(u.id)}"
                          >
                            Sửa / Đổi Pass
                          </button>
                          ${
                            !isSelf
                              ? `
                            <button
                              type="button"
                              class="btn-clean btn-sm btn-danger-clean"
                              data-admin-delete-btn="${escapeHtml(u.id)}"
                              data-admin-delete-name="${escapeHtml(u.username)}"
                            >
                              Xóa
                            </button>
                          `
                              : ''
                          }
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function formatOverviewMoney(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return `${Math.round(Number(val)).toLocaleString('vi-VN')} VNĐ`;
}

function formatOverviewNumber(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return Math.round(Number(val)).toLocaleString('vi-VN');
}

function renderDeltaComparison(comp) {
  if (!comp || comp.deltaPct === null || comp.deltaPct === undefined) {
    return `<span class="ov-comp-neutral">Chưa có kỳ so sánh trước</span>`;
  }
  const pct = Number(comp.deltaPct);
  const sign = pct > 0 ? `+${pct}%` : `${pct}%`;
  const tone = pct <= 0 ? 'is-good' : 'is-warn';
  return `
    <span class="ov-comp-badge ${tone}">${escapeHtml(sign)} so với kỳ trước</span>
    <span class="ov-comp-base">Kỳ trước: ${escapeHtml(formatOverviewMoney(comp.baseline))}</span>
  `;
}

export function renderAdminOverview(overviewData = null, overviewState = {}) {
  const {
    overviewLoading = false,
    overviewPeriod = 'month',
    overviewCustomFrom = '',
    overviewCustomTo = '',
  } = overviewState;

  const periodLabels = {
    today: 'Hôm nay',
    week: 'Tuần này',
    month: 'Tháng này',
    lastmonth: 'Tháng trước',
    all: 'Toàn bộ dữ liệu',
    custom:
      overviewCustomFrom && overviewCustomTo
        ? `Từ ${isoToVnDate(overviewCustomFrom)} đến ${isoToVnDate(overviewCustomTo)}`
        : 'Tùy chọn ngày',
  };

  if (overviewLoading && !overviewData) {
    return `
      <div class="admin-overview-panel">
        <div class="sheet-card ov-loading-card">
          <div class="spinner"></div>
          <p>Đang tổng hợp số liệu Điều hành, Doanh số & Tài chính Marketing...</p>
        </div>
      </div>
    `;
  }

  const ov = overviewData || {
    crm: {
      leads: 0,
      appointments: 0,
      pastAppointments: 0,
      derivedAppointments: 0,
      arrived: 0,
      revenue: 0,
      avgOrderValue: 0,
    },
    marketing: {
      received: 0,
      adsCost: 0,
      managementFee: 0,
      cost: 0,
      balance: 0,
      messages: 0,
      costRevenueRatio: null,
      costPerData: null,
      costPerAppointment: null,
      costPerArrived: null,
      costPerDataComparison: null,
      costPerArrivedComparison: null,
      budgetRecommendation: {
        action: 'hold',
        label: 'Giữ nguyên ngân sách',
        reason: 'Đang đồng bộ số liệu...',
      },
    },
    serviceFunnel: [],
    telesaleLeaderboard: [],
    arrivedCustomers: [],
    appointments: { upcoming: [], recentPast: [] },
    integrity: { ok: true, totalIssues: 0, criticalCount: 0, warningCount: 0, issues: [] },
  };

  const crm = ov.crm || {};
  const mkt = ov.marketing || {};
  const rec = mkt.budgetRecommendation || {};
  const integrity = ov.integrity || { ok: true, issues: [] };
  const serviceFunnel = Array.isArray(ov.serviceFunnel) ? ov.serviceFunnel : [];
  const leaderboard = Array.isArray(ov.telesaleLeaderboard) ? ov.telesaleLeaderboard : [];
  const arrivedCustomers = Array.isArray(ov.arrivedCustomers) ? ov.arrivedCustomers : [];
  const upcomingAppts = Array.isArray(ov.appointments?.upcoming) ? ov.appointments.upcoming : [];
  const recentPastAppts = Array.isArray(ov.appointments?.recentPast)
    ? ov.appointments.recentPast
    : [];

  const ratioVal = mkt.costRevenueRatio;
  const ratioText =
    ratioVal !== null && ratioVal !== undefined && Number.isFinite(Number(ratioVal))
      ? `${Number(ratioVal).toFixed(1)}%`
      : '—';

  return `
    <div class="admin-overview-panel">
      <!-- Header & Bộ lọc kỳ (Tích hợp từ vanhao1997/crm-tram-chua-da) -->
      <div class="sheet-card ov-header-card">
        <div class="ov-header-top">
          <div>
            <span class="ov-eyebrow">KHÔNG GIAN ĐIỀU HÀNH — TRẠM CHỮA DA BSN</span>
            <h2 class="ov-main-title">Tổng Quan Vận Hành, Doanh Số & Tài Chính Marketing</h2>
            <p class="ov-period-subtitle">
              Đang xem: <strong>${escapeHtml(periodLabels[overviewPeriod] || 'Tháng này')}</strong>
              ${
                ov.period?.start && ov.period?.end
                  ? `<span>(${escapeHtml(isoToVnDate(ov.period.start))} – ${escapeHtml(
                      isoToVnDate(ov.period.end)
                    )})</span>`
                  : ''
              }
            </p>
          </div>
          <div class="ov-status-pill ${integrity.ok ? 'is-ok' : 'is-warn'}">
            <span class="ov-status-dot"></span>
            <span>${
              integrity.ok
                ? 'Dữ liệu CRM & Marketing đối soát ổn định'
                : `Phát hiện ${integrity.totalIssues || 0} cảnh báo đối soát dữ liệu`
            }</span>
          </div>
        </div>

        <div class="ov-filter-bar">
          <div class="ov-period-tabs" id="ov-period-tabs">
            <button type="button" class="ov-period-btn ${
              overviewPeriod === 'today' ? 'active' : ''
            }" data-overview-period="today">Hôm nay</button>
            <button type="button" class="ov-period-btn ${
              overviewPeriod === 'week' ? 'active' : ''
            }" data-overview-period="week">Tuần này</button>
            <button type="button" class="ov-period-btn ${
              overviewPeriod === 'month' ? 'active' : ''
            }" data-overview-period="month">Tháng này</button>
            <button type="button" class="ov-period-btn ${
              overviewPeriod === 'lastmonth' ? 'active' : ''
            }" data-overview-period="lastmonth">Tháng trước</button>
            <button type="button" class="ov-period-btn ${
              overviewPeriod === 'all' ? 'active' : ''
            }" data-overview-period="all">Toàn bộ</button>
            <button type="button" class="ov-period-btn ${
              overviewPeriod === 'custom' ? 'active' : ''
            }" data-overview-period="custom">Tùy chọn ngày</button>
          </div>

          ${
            overviewPeriod === 'custom'
              ? `
            <div class="ov-custom-range">
              <input type="date" id="ov-custom-from" class="inline-date-picker has-date" value="${escapeHtml(
                overviewCustomFrom || ov.period?.start || ''
              )}" />
              <span>đến</span>
              <input type="date" id="ov-custom-to" class="inline-date-picker has-date" value="${escapeHtml(
                overviewCustomTo || ov.period?.end || ''
              )}" />
              <button type="button" class="btn-clean btn-primary-clean" id="btn-apply-ov-custom">Áp dụng</button>
            </div>
          `
              : ''
          }
        </div>
      </div>

      <!-- PHÂN HỆ 1: PHỄU CRM & DOANH SỐ THỰC THU (CỘT W) -->
      <div class="ov-section-block">
        <div class="ov-section-heading">
          <h3>1. Chỉ Số Phễu CRM & Doanh Số Thực Thu (Chỉ Admin)</h3>
          <span>Tổng hợp trực tiếp từ 3 Sheet CRM (Data Nguồn MKT · Khách Đặt Hẹn · Khách Đã Đến)</span>
        </div>

        <div class="ov-kpi-grid-4">
          <div class="ov-kpi-card is-Revenue-highlight">
            <span class="ov-kpi-label">DOANH SỐ THỰC THU (CỘT W)</span>
            <strong class="ov-kpi-value is-emerald">${escapeHtml(
              formatOverviewMoney(crm.revenue)
            )}</strong>
            <span class="ov-kpi-sub">
              TB: ${escapeHtml(formatOverviewMoney(crm.avgOrderValue))} / khách đến
            </span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">TỔNG LEAD MKT TRONG KỲ</span>
            <strong class="ov-kpi-value">${escapeHtml(formatOverviewNumber(crm.leads))}</strong>
            <span class="ov-kpi-sub">Khách phát sinh theo ngày Data (Cột B)</span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">LỊCH HẸN TRONG KỲ</span>
            <strong class="ov-kpi-value is-blue">${escapeHtml(
              formatOverviewNumber(crm.appointments)
            )}</strong>
            <span class="ov-kpi-sub">
              Lịch đã qua: <strong>${escapeHtml(formatOverviewNumber(crm.pastAppointments))}</strong>
              ${crm.derivedAppointments > 0 ? ` · Tự đồng bộ: ${crm.derivedAppointments}` : ''}
            </span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">KHÁCH ĐÃ ĐẾN CƠ SỞ</span>
            <strong class="ov-kpi-value is-teal">${escapeHtml(
              formatOverviewNumber(crm.arrived)
            )}</strong>
            <span class="ov-kpi-sub">
              Tỷ lệ đến / lịch hẹn: <strong>${
                crm.appointments > 0
                  ? `${((crm.arrived / crm.appointments) * 100).toFixed(1)}%`
                  : '0%'
              }</strong>
            </span>
          </div>
        </div>
      </div>

      <!-- PHÂN HỆ 2: TÀI CHÍNH & NGÂN SÁCH MARKETING (TỪ SHEET 2026) -->
      <div class="ov-section-block">
        <div class="ov-section-heading">
          <h3>2. Tài Chính & Chi Phí Marketing (Đồng bộ Sheet Marketing 2026)</h3>
          <span>Đo lường Ngân sách, Chi phí Ads, Phí quản lý & Cost per Result</span>
        </div>

        <div class="ov-kpi-grid-4">
          <div class="ov-kpi-card">
            <span class="ov-kpi-label">TỔNG NHẬN NGÂN SÁCH</span>
            <strong class="ov-kpi-value">${escapeHtml(formatOverviewMoney(mkt.received))}</strong>
            <span class="ov-kpi-sub">Số dư còn: <strong>${escapeHtml(
              formatOverviewMoney(mkt.balance)
            )}</strong></span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">TỔNG CHI PHÍ MARKETING</span>
            <strong class="ov-kpi-value is-rose">${escapeHtml(
              formatOverviewMoney(mkt.cost)
            )}</strong>
            <span class="ov-kpi-sub">
              Ads: ${escapeHtml(formatOverviewMoney(mkt.adsCost))} · Phí QL: ${escapeHtml(
    formatOverviewMoney(mkt.managementFee)
  )}
            </span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">TỶ LỆ CHI PHÍ / DOANH THU</span>
            <strong class="ov-kpi-value ${
              ratioVal !== null && ratioVal <= 30 ? 'is-emerald' : 'is-amber'
            }">${escapeHtml(ratioText)}</strong>
            <span class="ov-kpi-sub">${escapeHtml(rec.label || 'Đang theo dõi')}</span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">TỔNG TIN NHẮN MKT</span>
            <strong class="ov-kpi-value">${escapeHtml(
              formatOverviewNumber(mkt.messages)
            )}</strong>
            <span class="ov-kpi-sub">${escapeHtml(rec.reason || '')}</span>
          </div>
        </div>

        <div class="ov-kpi-grid-3" style="margin-top: 12px;">
          <div class="ov-kpi-card">
            <span class="ov-kpi-label">GIÁ 1 DATA (COST / LEAD)</span>
            <strong class="ov-kpi-value">${escapeHtml(
              formatOverviewMoney(mkt.costPerData)
            )}</strong>
            <div class="ov-kpi-comp">${renderDeltaComparison(mkt.costPerDataComparison)}</div>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">GIÁ 1 LỊCH HẸN (COST / BOOKING)</span>
            <strong class="ov-kpi-value">${escapeHtml(
              formatOverviewMoney(mkt.costPerAppointment)
            )}</strong>
            <span class="ov-kpi-sub">Chi phí MKT / Tổng lịch hẹn trong kỳ</span>
          </div>

          <div class="ov-kpi-card">
            <span class="ov-kpi-label">GIÁ 1 KHÁCH ĐẾN (COST / ARRIVED)</span>
            <strong class="ov-kpi-value">${escapeHtml(
              formatOverviewMoney(mkt.costPerArrived)
            )}</strong>
            <div class="ov-kpi-comp">${renderDeltaComparison(mkt.costPerArrivedComparison)}</div>
          </div>
        </div>
      </div>

      <!-- PHÂN HỆ 3: PHỄU DỊCH VỤ & BẢNG XẾP HẠNG HIỆU SUẤT TELESALE -->
      <div class="ov-two-col-grid">
        <div class="sheet-card ov-table-card">
          <div class="ov-card-header">
            <h3>Phễu Chuyển Đổi Theo Hạng Mục Dịch Vụ</h3>
            <span>Data → Đặt Hẹn → Khách Đến → Doanh Số</span>
          </div>
          <div class="table-wrap">
            <table class="lead-table ov-compact-table">
              <thead>
                <tr>
                  <th>Nhóm Dịch Vụ</th>
                  <th>Data</th>
                  <th>Đặt Hẹn</th>
                  <th>Khách Đến</th>
                  <th>Doanh Số</th>
                </tr>
              </thead>
              <tbody>
                ${serviceFunnel
                  .map(
                    (s) => `
                  <tr>
                    <td><strong>${escapeHtml(s.label)}</strong></td>
                    <td>${escapeHtml(formatOverviewNumber(s.leads))}</td>
                    <td>
                      <strong>${escapeHtml(formatOverviewNumber(s.booked))}</strong>
                      <small class="ov-rate-sub">(${s.bookingRate}%)</small>
                    </td>
                    <td>
                      <strong>${escapeHtml(formatOverviewNumber(s.arrived))}</strong>
                      <small class="ov-rate-sub">(${s.arrivalRate}%)</small>
                    </td>
                    <td><strong class="is-emerald-text">${escapeHtml(
                      formatOverviewMoney(s.revenue)
                    )}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="sheet-card ov-table-card">
          <div class="ov-card-header">
            <h3>Hiệu Suất & Doanh Số Theo Nhân Sự Telesale</h3>
            <span>Đánh giá tỷ lệ chốt hẹn & doanh số mang về theo Cột L</span>
          </div>
          <div class="table-wrap">
            <table class="lead-table ov-compact-table">
              <thead>
                <tr>
                  <th>Telesale (Cột L)</th>
                  <th>Data Nhận</th>
                  <th>Chốt Hẹn</th>
                  <th>Khách Đến</th>
                  <th>Doanh Số Mang Về</th>
                </tr>
              </thead>
              <tbody>
                ${leaderboard
                  .map(
                    (st) => `
                  <tr>
                    <td><span class="telesale-name-badge">${escapeHtml(st.telesale)}</span></td>
                    <td>${escapeHtml(formatOverviewNumber(st.leads))}</td>
                    <td>
                      <strong>${escapeHtml(formatOverviewNumber(st.booked))}</strong>
                      <small class="ov-rate-sub">(${st.bookingRate}%)</small>
                    </td>
                    <td>
                      <strong>${escapeHtml(formatOverviewNumber(st.arrived))}</strong>
                    </td>
                    <td><strong class="is-emerald-text">${escapeHtml(
                      formatOverviewMoney(st.revenue)
                    )}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- PHÂN HỆ 4: BẢNG ĐỐI SOÁT KHÁCH ĐÃ ĐẾN & DOANH SỐ CỘT W -->
      <div class="sheet-card ov-table-card">
        <div class="ov-card-header">
          <h3>Chi Tiết Khách Đã Đến & Doanh Số Cột W (${arrivedCustomers.length} khách)</h3>
          <span>Chỉ hiển thị cho tài khoản Admin — Tự động ẩn hoàn toàn đối với Telesale</span>
        </div>
        <div class="table-wrap">
          <table class="lead-table ov-compact-table">
            <thead>
              <tr>
                <th>Ngày Đến</th>
                <th>Khách Hàng</th>
                <th>Điện Thoại</th>
                <th>Dịch Vụ</th>
                <th>Telesale</th>
                <th>Doanh Số (Cột W)</th>
                <th>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${
                arrivedCustomers.length === 0
                  ? `<tr><td colspan="7" class="empty-state">Chưa có khách đến trong kỳ đã chọn.</td></tr>`
                  : arrivedCustomers
                      .slice(0, 30)
                      .map(
                        (c) => `
                    <tr>
                      <td>${escapeHtml(c.apptDate || c.dataDate || '—')}</td>
                      <td><strong>${escapeHtml(c.name)}</strong></td>
                      <td><span class="phone-num">${escapeHtml(c.phoneDisplay)}</span></td>
                      <td>${escapeHtml(c.service || '—')}</td>
                      <td><span class="telesale-name-badge">${escapeHtml(c.telesale)}</span></td>
                      <td>
                        ${
                          c.revenue !== null && c.revenue !== undefined
                            ? `<strong class="is-emerald-text">${escapeHtml(
                                formatOverviewMoney(c.revenue)
                              )}</strong>`
                            : `<span class="ov-missing-rev-badge">Chưa nhập doanh số Cột W</span>`
                        }
                      </td>
                      <td>${escapeHtml(c.noteM || '—')}</td>
                    </tr>
                  `
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- PHÂN HỆ 5: LỊCH HẸN SẮP TỚI & KIỂM TRA TOÀN VẸN DỮ LIỆU -->
      <div class="ov-two-col-grid">
        <div class="sheet-card ov-table-card">
          <div class="ov-card-header">
            <h3>Lịch Hẹn Sắp Tới (${upcomingAppts.length}) & 7 Ngày Qua (${
    recentPastAppts.length
  })</h3>
            <span>Theo dõi tiến độ khách đặt hẹn đến cơ sở</span>
          </div>
          <div class="ov-appt-lists">
            <div class="ov-appt-sublist">
              <h4>Sắp tới (${upcomingAppts.length})</h4>
              ${
                upcomingAppts.length === 0
                  ? `<p class="ov-empty-note">Không có lịch hẹn sắp tới.</p>`
                  : upcomingAppts
                      .slice(0, 6)
                      .map(
                        (a) => `
                    <div class="ov-appt-item">
                      <div>
                        <strong>${escapeHtml(a.name)}</strong>
                        <span>· ${escapeHtml(a.service)}</span>
                      </div>
                      <div class="ov-appt-meta">
                        <span class="ov-appt-date">${escapeHtml(a.apptDate)} (${escapeHtml(
                          a.apptTime
                        )})</span>
                        <span class="telesale-name-badge">${escapeHtml(a.telesale)}</span>
                      </div>
                    </div>
                  `
                      )
                      .join('')
              }
            </div>
            <div class="ov-appt-sublist">
              <h4>7 ngày gần nhất (${recentPastAppts.length})</h4>
              ${
                recentPastAppts.length === 0
                  ? `<p class="ov-empty-note">Không có lịch hẹn trong 7 ngày qua.</p>`
                  : recentPastAppts
                      .slice(0, 6)
                      .map(
                        (a) => `
                    <div class="ov-appt-item">
                      <div>
                        <strong>${escapeHtml(a.name)}</strong>
                        <span>· ${escapeHtml(a.service)}</span>
                      </div>
                      <div class="ov-appt-meta">
                        <span class="ov-appt-date">${escapeHtml(a.apptDate)}</span>
                        <span class="ov-visit-badge ${a.visited ? 'is-visited' : ''}">${escapeHtml(
                          a.statusLabel
                        )}</span>
                      </div>
                    </div>
                  `
                      )
                      .join('')
              }
            </div>
          </div>
        </div>

        <div class="sheet-card ov-table-card">
          <div class="ov-card-header">
            <h3>Kiểm Tra Toàn Vẹn & Đối Soát Dữ Liệu (${integrity.issues?.length || 0})</h3>
            <span>Tự động phát hiện khách đến thiếu doanh số hoặc lệch bảng Marketing</span>
          </div>
          <div class="ov-integrity-list">
            ${
              !integrity.issues || integrity.issues.length === 0
                ? `<div class="ov-integrity-ok">✅ Tất cả bản ghi trong kỳ đã khớp và đầy đủ doanh số!</div>`
                : integrity.issues
                    .slice(0, 12)
                    .map(
                      (iss) => `
                  <div class="ov-issue-item is-${escapeHtml(iss.severity || 'warning')}">
                    <span class="ov-issue-code">${escapeHtml(iss.code)}</span>
                    <span class="ov-issue-msg">${escapeHtml(iss.message)}</span>
                  </div>
                `
                    )
                    .join('')
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderKanbanBoard(records = [], statusOptions = [], telesaleList = [], options = {}) {
  const stages = [
    { key: 'new', title: 'Chưa gọi (Mới)', color: 'amber' },
    { key: 'booked', title: 'Đặt Hẹn / Dời Lịch', color: 'emerald' },
    { key: 'followup', title: 'Hẹn Gọi Lại / Care thêm', color: 'blue' },
    { key: 'unreachable', title: 'Không Nghe Máy / Thuê Bao', color: 'orange' },
    { key: 'arrived', title: 'Đã Đến Cơ Sở', color: 'teal' },
    { key: 'lost', title: 'Hủy / Từ Chối', color: 'rose' },
  ];

  return `
    <div class="airtable-kanban-wrap">
      ${stages
        .map((st) => {
          const stageItems = records.filter((r) => (r.statusGroup || 'new') === st.key);
          return `
            <div class="airtable-kanban-col">
              <div class="airtable-kanban-col-header">
                <span class="airtable-stage-pill pill-${escapeHtml(st.color)}">
                  ${escapeHtml(st.title)}
                </span>
                <span class="airtable-stage-count">${stageItems.length}</span>
              </div>
              <div class="airtable-kanban-cards">
                ${
                  stageItems.length === 0
                    ? `<div class="airtable-kanban-empty">Trống</div>`
                    : stageItems
                        .slice(0, 40)
                        .map((rec) => renderCard(rec, statusOptions, telesaleList, options))
                        .join('')
                }
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderGroupedRows(records, statusOptions, telesaleList, groupBy, options = {}) {
  if (!groupBy || groupBy === 'none') {
    return records.map((rec) => renderRow(rec, statusOptions, telesaleList, options)).join('');
  }

  const groups = new Map();
  for (const rec of records) {
    let gKey = '';
    if (groupBy === 'status') {
      gKey = rec.statusLabel || rec.status || 'Chưa gọi (Mới)';
    } else if (groupBy === 'telesale') {
      gKey = rec.telesale || 'Chưa phân bổ';
    }
    if (!groups.has(gKey)) groups.set(gKey, []);
    groups.get(gKey).push(rec);
  }

  let html = '';
  for (const [groupLabel, groupItems] of groups.entries()) {
    html += `
      <tr class="airtable-group-header-row">
        <td colspan="7">
          <div class="airtable-group-banner">
            <span class="airtable-group-field-name">
              ${groupBy === 'status' ? 'Tình trạng' : 'Telesale'}:
            </span>
            <strong class="airtable-group-val">${escapeHtml(groupLabel)}</strong>
            <span class="airtable-group-count">${groupItems.length} khách</span>
          </div>
        </td>
      </tr>
      ${groupItems.map((rec) => renderRow(rec, statusOptions, telesaleList, options)).join('')}
    `;
  }
  return html;
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (state.authChecking) {
    app.innerHTML = `
      <div class="app-loading">
        <div class="spinner"></div>
        <p>Đang kiểm tra quyền truy cập...</p>
      </div>
    `;
    return;
  }

  // Nếu chưa đăng nhập -> Hiển thị màn hình Đăng nhập (CRM không public)
  if (!state.currentUser) {
    app.innerHTML = renderLoginScreen(state);
    bindLoginEvents();
    renderToasts();
    return;
  }

  const isAdmin = state.currentUser.role === 'admin';
  // Đảm bảo tài khoản Telesale tuyệt đối không bao giờ ở trong tab 'admin' hoặc 'overview'
  if (!isAdmin && (state.activeTab === 'admin' || state.activeTab === 'overview')) {
    state.activeTab = 'mkt';
  }

  if (state.loading && !state.crmData) {
    app.innerHTML = `
      <div class="app-loading">
        <div class="spinner"></div>
        <p>Đang tải dữ liệu CRM...</p>
      </div>
    `;
    return;
  }

  const data = state.crmData || {
    telesaleList: [],
    statusOptions: [],
    sheets: {
      mkt: { records: [] },
      booked: { records: [] },
      arrived: { records: [] },
    },
  };
  const telesaleList = data.telesaleList || [];
  const statusOptions = data.statusOptions || [];
  const apptSummary = getAppointmentSummary(data);
  const allTabRecords = getActiveRecords();
  const filtered = getFilteredRecords();

  const months = Array.from(new Set(allTabRecords.map((r) => r.monthKey).filter(Boolean)));
  const currentMonthKey = getCurrentMonthKey(allTabRecords);
  const effectiveMonth = resolveEffectiveMonthKey(allTabRecords, state.filters.monthKey);

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pagination.pageSize));
  if (state.pagination.page > totalPages) state.pagination.page = totalPages;
  const start = (state.pagination.page - 1) * state.pagination.pageSize;
  const paged = filtered.slice(start, start + state.pagination.pageSize);

  const bookedCount = filtered.filter((r) => r.statusGroup === 'booked').length;
  const arrivedCount = filtered.filter((r) => r.statusGroup === 'arrived').length;
  const newCount = filtered.filter((r) => r.statusGroup === 'new').length;

  const hasActiveFilter =
    state.filters.search ||
    state.filters.telesale !== 'all' ||
    state.filters.status !== 'all' ||
    (state.activeTab !== 'today' && effectiveMonth !== currentMonthKey);

  const todayShort = apptSummary.todayVn.slice(0, 5);
  const tomorrowShort = apptSummary.tomorrowVn.slice(0, 5);

  const prevScrollY = typeof window !== 'undefined' ? window.scrollY : 0;

  app.innerHTML = `
    <header class="topbar airtable-base-topbar">
      <div class="topbar-brand-row">
        <div class="brand">
          <img
            src="/brandmark.webp"
            onerror="this.onerror=null;this.src='https://crm-bsn.vibecodingsolution.ovh/brandmark.webp'"
            alt="BSN"
            class="brand-logo"
            width="38"
            height="38"
          />
          <div class="brand-text-stack">
            <span class="brand-title">Sales CRM — Trạm Chữa Da BSN</span>
            <span class="rust-engine-badge" title="Powered by Rust Axum Core & Airtable Sales CRM">🦀 Rust Core</span>
          </div>
        </div>

        <div class="topbar-right">
          ${
            isAdmin
              ? `
            <button
              type="button"
              class="btn-clean btn-primary-clean btn-add-lead-top"
              data-open-add-lead="1"
              title="Thêm khách hàng mới (Chỉ Admin)"
            >
              ➕ Thêm Data
            </button>
          `
              : ''
          }
          <div class="user-session-pill" title="Tài khoản đang đăng nhập">
            <span class="user-role-dot ${isAdmin ? 'is-admin' : 'is-telesale'}"></span>
            <span class="user-session-name">${escapeHtml(
              state.currentUser.telesaleName || state.currentUser.username
            )}</span>
            <span class="user-session-role">${isAdmin ? 'Admin' : 'Telesale'}</span>
          </div>
          <button class="btn-clean" id="btn-refresh" ${state.refreshing ? 'disabled' : ''}>
            ${state.refreshing ? 'Đang tải...' : '↻ Làm mới'}
          </button>
          <button class="btn-clean btn-logout" id="btn-logout" title="Đăng xuất tài khoản">
            Đăng xuất
          </button>
        </div>
      </div>

      <div class="topbar-nav-row">
        <nav class="nav-tabs airtable-table-tabs">
          <button class="nav-tab ${state.activeTab === 'mkt' ? 'active' : ''}" data-tab="mkt">
            <span class="nav-tab-icon">📊</span>
            <span>Data Nguồn MKT</span>
            <span class="tab-badge">${data.sheets.mkt.records.length}</span>
          </button>
          <button class="nav-tab ${state.activeTab === 'booked' ? 'active' : ''}" data-tab="booked">
            <span class="nav-tab-icon">📅</span>
            <span>Khách Đặt Hẹn</span>
            <span class="tab-badge">${data.sheets.booked.records.length}</span>
          </button>
          <button class="nav-tab ${state.activeTab === 'arrived' ? 'active' : ''}" data-tab="arrived">
            <span class="nav-tab-icon">✅</span>
            <span>Khách Đã Đến</span>
            <span class="tab-badge">${data.sheets.arrived.records.length}</span>
          </button>
          <button class="nav-tab nav-tab-today ${state.activeTab === 'today' ? 'active' : ''}" data-tab="today">
            <span class="today-pulse-dot"></span>
            <span>Nhắc Lịch Hôm Nay</span>
            <span class="tab-badge tab-badge-today">${apptSummary.todayList.length}</span>
          </button>
          ${
            isAdmin
              ? `
            <button class="nav-tab nav-tab-overview ${
              state.activeTab === 'overview' ? 'active' : ''
            }" data-tab="overview">
              <span class="nav-tab-icon">📈</span>
              <span>Tổng Quan & Doanh Số (CEO)</span>
            </button>
            <button class="nav-tab nav-tab-admin ${
              state.activeTab === 'admin' ? 'active' : ''
            }" data-tab="admin">
              <span class="nav-tab-icon">⚙️</span>
              <span>Quản Lý Nhân Sự</span>
            </button>
          `
              : ''
          }
        </nav>
      </div>
    </header>

    <main class="workspace">
      ${
        state.activeTab === 'overview' && isAdmin
          ? renderAdminOverview(state.adminOverview, state)
          : state.activeTab === 'admin' && isAdmin
          ? renderAdminView(
              state.adminUsers,
              state.editingUserId,
              state.currentUser.id,
              state.telegramSchedule
            )
          : `
      ${
        state.activeTab !== 'today'
          ? `
        <div class="reminder-banner">
          <div class="reminder-banner-left">
            <span class="reminder-bell-badge">Nhắc lịch</span>
            <div class="reminder-banner-text">
              <strong>Hôm nay (${escapeHtml(apptSummary.todayVn)}):</strong>
              có <strong>${apptSummary.todayList.length} khách hẹn</strong>${
                apptSummary.todayNeedCallCount > 0
                  ? ` <span class="reminder-highlight">(${apptSummary.todayNeedCallCount} khách cần gọi xác nhận)</span>`
                  : ''
              }
              <span class="reminder-sep">·</span>
              <span>Ngày mai (${escapeHtml(tomorrowShort)}): <strong>${apptSummary.tomorrowList.length} khách</strong></span>
              ${
                isAdmin
                  ? `<span class="reminder-sep">·</span><button type="button" class="auto-tele-badge ${
                      state.telegramSchedule?.enabled === false ? 'is-off' : ''
                    }" data-open-admin-tele="1" title="Bấm để mở cài đặt Bật/Tắt & Giờ gửi tự động qua Telegram">${
                      state.telegramSchedule?.enabled === false
                        ? '⏸️ Tự động báo: Đang tắt'
                        : `⏰ Tự động báo ${escapeHtml(state.telegramSchedule?.sendTime || '08:00')}`
                    }</button>`
                  : ''
              }
            </div>
          </div>
          <div class="reminder-banner-actions">
            <button type="button" class="btn-reminder-action is-primary" data-jump-reminder="today">
              Xem lịch hôm nay (${apptSummary.todayList.length})
            </button>
            <button type="button" class="btn-reminder-action" data-jump-reminder="tomorrow">
              Ngày mai (${apptSummary.tomorrowList.length})
            </button>
            <button type="button" class="btn-reminder-action" data-jump-reminder="upcoming">
              7 ngày tới (${apptSummary.upcomingList.length})
            </button>
            ${
              isAdmin
                ? `
              <button type="button" class="btn-reminder-action is-telegram-btn" data-send-telegram="today" title="Bắn danh sách lịch hẹn hôm nay vào nhóm Telegram (Chỉ Admin)">
                📨 Gửi Telegram
              </button>
            `
                : ''
            }
          </div>
        </div>
      `
          : ''
      }

      <div class="sheet-card airtable-sheet-card">
        ${
          state.activeTab === 'today'
            ? `
          <div class="reminder-subbar">
            <div class="reminder-range-pills">
              <button
                type="button"
                class="range-pill ${state.reminderRange === 'today' ? 'active' : ''}"
                data-reminder-range="today"
              >
                Hôm nay (${escapeHtml(todayShort)})
                <span class="range-count">${apptSummary.todayList.length}</span>
              </button>
              <button
                type="button"
                class="range-pill ${state.reminderRange === 'tomorrow' ? 'active' : ''}"
                data-reminder-range="tomorrow"
              >
                Ngày mai (${escapeHtml(tomorrowShort)})
                <span class="range-count">${apptSummary.tomorrowList.length}</span>
              </button>
              <button
                type="button"
                class="range-pill ${state.reminderRange === 'upcoming' ? 'active' : ''}"
                data-reminder-range="upcoming"
              >
                7 ngày tới
                <span class="range-count">${apptSummary.upcomingList.length}</span>
              </button>
            </div>
            <div class="reminder-custom-picker">
              <label for="reminder-custom-date">Xem theo ngày:</label>
              <input
                type="date"
                id="reminder-custom-date"
                class="inline-date-picker has-date"
                value="${escapeHtml(
                  state.reminderRange === 'custom' ? state.reminderCustomDate : apptSummary.todayIso
                )}"
              />
              ${
                isAdmin
                  ? `
                <button
                  type="button"
                  class="btn-reminder-action is-telegram-btn"
                  data-send-telegram="${state.reminderRange === 'tomorrow' ? 'tomorrow' : 'today'}"
                  title="Gửi danh sách lịch hẹn sang Telegram (Chỉ Admin)"
                >
                  📨 Gửi Telegram
                </button>
              `
                  : ''
              }
            </div>
          </div>
        `
            : ''
        }

        <div class="airtable-view-bar">
          <div class="airtable-view-switcher">
            <button
              type="button"
              class="airtable-view-btn ${state.viewMode === 'grid' ? 'active' : ''}"
              data-view-mode="grid"
            >
              <span>⊞ Grid View (Bảng Airtable)</span>
            </button>
            <button
              type="button"
              class="airtable-view-btn ${state.viewMode === 'kanban' ? 'active' : ''}"
              data-view-mode="kanban"
            >
              <span>▥ Kanban Pipeline (Theo Tình Trạng)</span>
            </button>
          </div>

          <div class="airtable-view-tools">
            <label class="airtable-tool-label" for="airtable-group-by">Nhóm (Group):</label>
            <select class="clean-select airtable-group-select" id="airtable-group-by">
              <option value="none" ${state.groupBy === 'none' ? 'selected' : ''}>Không nhóm</option>
              <option value="status" ${state.groupBy === 'status' ? 'selected' : ''}>Nhóm theo Tình trạng</option>
              <option value="telesale" ${state.groupBy === 'telesale' ? 'selected' : ''}>Nhóm theo Telesale</option>
            </select>
          </div>
        </div>

        <div class="toolbar">
          <div class="toolbar-filters">
            <div class="search-box">
              <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                id="search-input"
                placeholder="Tìm tên, số điện thoại, ghi chú..."
                value="${escapeHtml(state.filters.search)}"
              />
            </div>

            <select class="clean-select" id="filter-telesale">
              <option value="all" ${state.filters.telesale === 'all' ? 'selected' : ''}>Tất cả Telesale</option>
              <option value="UNASSIGNED" ${state.filters.telesale === 'UNASSIGNED' ? 'selected' : ''}>Chưa phân bổ</option>
              ${telesaleList
                .map(
                  (name) => `
                <option value="${escapeHtml(name)}" ${
                    state.filters.telesale === name ? 'selected' : ''
                  }>${escapeHtml(name)}</option>
              `
                )
                .join('')}
            </select>

            <select class="clean-select" id="filter-status">
              <option value="all" ${state.filters.status === 'all' ? 'selected' : ''}>Tất cả tình trạng</option>
              <option value="NEW" ${state.filters.status === 'NEW' ? 'selected' : ''}>Chưa gọi (Mới)</option>
              ${statusOptions
                .filter((o) => o.value !== '')
                .map(
                  (opt) => `
                <option value="${escapeHtml(opt.value)}" ${
                    state.filters.status === opt.value ? 'selected' : ''
                  }>${escapeHtml(opt.label)}</option>
              `
                )
                .join('')}
            </select>

            <select class="clean-select" id="filter-month">
              <option value="all" ${effectiveMonth === 'all' ? 'selected' : ''}>Tất cả tháng</option>
              ${months
                .map(
                  (m) => `
                <option value="${escapeHtml(m)}" ${
                    effectiveMonth === m ? 'selected' : ''
                  }>${m === currentMonthKey ? `Tháng này (${escapeHtml(m)})` : `Tháng ${escapeHtml(m)}`}</option>
              `
                )
                .join('')}
            </select>

            ${
              hasActiveFilter
                ? `<button class="btn-clean btn-clear" id="btn-clear-filter">Xóa lọc</button>`
                : ''
            }
          </div>

          <div class="toolbar-meta">
            ${
              isAdmin
                ? `
              <button
                type="button"
                class="btn-clean btn-primary-clean btn-add-lead-toolbar"
                id="btn-open-add-lead"
                data-open-add-lead="1"
              >
                ➕ Thêm Data
              </button>
            `
                : ''
            }
            <span><strong>${filtered.length}</strong> khách hàng</span>
          </div>
        </div>

        ${
          state.viewMode === 'kanban'
            ? renderKanbanBoard(filtered, statusOptions, telesaleList, { isAdmin })
            : isMobileViewport()
            ? `
        <div class="mobile-cards">
          ${
            paged.length === 0
              ? `<div class="card-empty-state">Không tìm thấy khách hàng phù hợp.</div>`
              : paged
                  .map((rec) => renderCard(rec, statusOptions, telesaleList, { isAdmin }))
                  .join('')
          }
        </div>
        `
            : `
        <div class="table-wrap airtable-grid-wrap">
          <table class="lead-table airtable-grid-table">
            <thead>
              <tr>
                <th class="col-date"><span class="th-icon">📅</span>Ngày</th>
                <th class="col-customer"><span class="th-icon">👤</span>Khách hàng</th>
                <th class="col-phone"><span class="th-icon">📞</span>Điện thoại</th>
                <th class="col-status"><span class="th-icon">🏷️</span>Tình trạng</th>
                <th class="col-appt"><span class="th-icon">⏰</span>Lịch hẹn</th>
                <th class="col-telesale"><span class="th-icon">👩‍💼</span>Telesale</th>
                <th class="col-note"><span class="th-icon">📝</span>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              ${
                paged.length === 0
                  ? `
                <tr>
                  <td colspan="7" class="empty-state">
                    Không tìm thấy khách hàng phù hợp.
                  </td>
                </tr>
              `
                  : renderGroupedRows(paged, statusOptions, telesaleList, state.groupBy, { isAdmin })
              }
            </tbody>
          </table>
        </div>
        `
        }

        <div class="airtable-summary-bar">
          <div class="summary-metric">
            <span class="summary-label">RECORDS</span>
            <strong>${filtered.length}</strong>
          </div>
          <div class="summary-metric">
            <span class="summary-label">ĐẶT HẸN</span>
            <strong class="is-emerald">${bookedCount}</strong>
          </div>
          <div class="summary-metric">
            <span class="summary-label">ĐÃ ĐẾN</span>
            <strong class="is-teal">${arrivedCount}</strong>
          </div>
          <div class="summary-metric">
            <span class="summary-label">CHƯA GỌI</span>
            <strong class="is-amber">${newCount}</strong>
          </div>
        </div>

        <div class="table-footer">
          <span>
            ${paged.length > 0 ? start + 1 : 0}–${start + paged.length} / ${filtered.length} khách hàng
          </span>
          <div class="pagination-btns">
            <span class="page-num">Trang ${state.pagination.page}/${totalPages}</span>
            <button class="btn-clean" id="btn-prev" ${
              state.pagination.page <= 1 ? 'disabled' : ''
            }>Trước</button>
            <button class="btn-clean" id="btn-next" ${
              state.pagination.page >= totalPages ? 'disabled' : ''
            }>Sau</button>
          </div>
        </div>
      </div>
      `
      }
    </main>

    ${state.editingRecordId ? renderEditModal(data) : ''}
    ${isAdmin && state.addLeadModalOpen ? renderAddLeadModal(data) : ''}
    ${isAdmin && state.arrivedModal ? renderArrivedRevenueModal(data, state.arrivedModal) : ''}
  `;

  bindEvents();
  renderToasts();
  if (typeof window !== 'undefined' && prevScrollY > 0) {
    try {
      window.scrollTo({ top: prevScrollY, behavior: 'instant' });
    } catch {
      window.scrollTo(0, prevScrollY);
    }
  }
}

export function fallbackCopyText(text) {
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.fontSize = '16px';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, 99999);
    document.execCommand('copy');
    document.body.removeChild(el);
  } catch (err) {
    console.error('Fallback copy failed', err);
  }
}

export function getDialPhone(rec) {
  const rawP = String(rec?.phone || rec?.rawPhone || '').trim();
  if (!rawP) return { dialPhone: '', hasValidPhone: false, displayPhone: '—' };
  const digits = rawP.replace(/\D/g, '');
  let dial = digits;
  if (digits.startsWith('0084') && digits.length === 13) {
    dial = `0${digits.slice(4)}`;
  } else if (digits.startsWith('84') && digits.length === 11) {
    dial = `0${digits.slice(2)}`;
  } else if (digits.length === 9 && !digits.startsWith('0')) {
    dial = `0${digits}`;
  }
  const hasValid = dial.length >= 9 && dial.length <= 11 && /^\d+$/.test(dial);
  const display = rec?.phoneDisplay || (hasValid ? dial : rawP) || '—';
  return {
    dialPhone: hasValid ? dial : '',
    hasValidPhone: hasValid,
    displayPhone: display,
  };
}

function toShortVnDate(rawDate) {
  const str = String(rawDate || '').trim();
  if (!str) return '';
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}`;
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[3]}/${iso[2]}`;
  }
  return '';
}

export function formatNowVnStamp(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}h${min}`;
}

export function ensureNoteTimestampPrefix(rawNote, date = new Date()) {
  const trimmed = String(rawNote || '').trim();
  if (!trimmed) return '';
  if (/^\d{1,2}[/-]\d{1,2}\b/.test(trimmed)) {
    return trimmed;
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  if (/^\d{1,2}(?:h\d{0,2}|:\d{2})\b/i.test(trimmed)) {
    return `${dd}/${mm} ${trimmed}`;
  }
  return `${formatNowVnStamp(date)} ${trimmed}`;
}

function parseSingleContactNote(rawText, fallbackDateShort = '', addedAtIso = '') {
  const text = String(rawText || '').trim();
  let dateShort = '';
  let isInferredDate = false;

  // 1. Kiểm tra ngày liên hệ ghi ở đầu câu (VD: "15/10 8h33...", "3/10: ...")
  const startDateMatch = text.match(/^\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s|$|:|,|-)/);
  if (startDateMatch) {
    dateShort = `${startDateMatch[1].padStart(2, '0')}/${startDateMatch[2].padStart(2, '0')}`;
  } else {
    // Kiểm tra ngày liên hệ sau dấu phẩy đi kèm giờ/cuộc gọi (VD: "..., 7/3 10h38 hẹn...")
    const clauseDateMatch = text.match(
      /[,;]\s*(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\s+(?:\d{1,2}h|\d{1,2}:\d{2}|\d+\s*c\b|gọi|gl\b|knm\b|tb\b)/i
    );
    if (clauseDateMatch) {
      dateShort = `${clauseDateMatch[1].padStart(2, '0')}/${clauseDateMatch[2].padStart(2, '0')}`;
    }
  }

  if (!dateShort && addedAtIso) {
    const d = new Date(addedAtIso);
    if (!Number.isNaN(d.getTime())) {
      dateShort = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  if (!dateShort && fallbackDateShort) {
    dateShort = fallbackDateShort;
    isInferredDate = true;
  }

  // 2. Bóc tách giờ liên hệ (loại trừ giờ hẹn sau các từ "hẹn", "dời", "chốt", "qua", "tới", "mai")
  const times = [];
  const startTimeMatch = text.match(
    /^\s*(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?[\s:,-]+)?(?:\d+\s*c\s+)?(\d{1,2}h\d{0,2}|\d{1,2}:\d{2})\b/i
  );
  if (startTimeMatch) {
    times.push(startTimeMatch[1]);
  }

  const clauseTimeRegex =
    /[,;]\s*(?:\d{1,2}[/-]\d{1,2}\s+)?(?:\d+\s*c\s+)?(\d{1,2}h\d{0,2}|\d{1,2}:\d{2})(?=\s+(?:\d+\s*c\b|knm|tb|thuê|zl|gọi|gl\b|lhl|nghe|bận|báo|chat))/gi;
  let cm;
  while ((cm = clauseTimeRegex.exec(text)) !== null) {
    if (!times.includes(cm[1])) {
      times.push(cm[1]);
    }
  }

  if (times.length === 0 && addedAtIso) {
    const d = new Date(addedAtIso);
    if (!Number.isNaN(d.getTime())) {
      times.push(`${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`);
    }
  }

  // 3. Đếm số cuộc gọi thực tế trong lần liên hệ (VD: "2c knm", "3c tb", "4 cuộc")
  let callCount = 0;
  const callRegex = /\b(\d{1,2})\s*(?:c|cuộc)(?=\s|$|,|\.|knm|tb|thuê|zl|gọi)/gi;
  let callMatch;
  while ((callMatch = callRegex.exec(text)) !== null) {
    const n = Number(callMatch[1]);
    if (n > 0 && n <= 20) {
      callCount += n;
    }
  }
  if (callCount === 0) {
    callCount = Math.max(1, times.length);
  }

  return {
    rawText: text,
    dateShort,
    isInferredDate,
    timeLabel: times.join(' → '),
    lastTime: times.length > 0 ? times[times.length - 1] : '',
    callCount,
  };
}

export function analyzeContactLogs(rec) {
  const noteMText = String(rec?.noteM || '').trim();
  const careHistory = Array.isArray(rec?.careHistory) ? rec.careHistory : [];
  const cacheSig = `${rec?.dataDate || ''}|${noteMText}|${careHistory
    .map((c) => c?.text || c || '')
    .join('~')}`;

  if (rec && typeof rec === 'object') {
    const cached = contactLogsCache.get(rec);
    if (cached && cached.sig === cacheSig) {
      return cached.result;
    }
  }

  const dataDateShort = toShortVnDate(rec?.dataDate);
  let runningDateShort = dataDateShort;
  const entries = [];

  let firstNoteEntry = null;
  if (noteMText) {
    const parsed = parseSingleContactNote(noteMText, runningDateShort, '');
    if (parsed.dateShort) runningDateShort = parsed.dateShort;
    firstNoteEntry = {
      step: 1,
      label: 'Lần 1',
      source: 'noteM',
      ...parsed,
    };
    entries.push(firstNoteEntry);
  }

  const careEntries = [];
  for (let i = 0; i < careHistory.length; i++) {
    const item = careHistory[i];
    const txt = String(item?.text || item || '').trim();
    if (!txt) continue;
    const parsed = parseSingleContactNote(txt, runningDateShort, item?.addedAt || '');
    if (parsed.dateShort) runningDateShort = parsed.dateShort;
    const stepNum = entries.length + 1;
    const entry = {
      step: stepNum,
      label: `Lần ${stepNum}`,
      source: 'care',
      careIndex: i,
      ...parsed,
    };
    entries.push(entry);
    careEntries.push(entry);
  }

  const totalContacts = entries.length;
  const totalCallAttempts = entries.reduce((sum, e) => sum + e.callCount, 0);
  const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const latestDateShort = latestEntry?.dateShort || '';
  const latestTime = latestEntry?.lastTime || '';
  const latestSummary = latestDateShort
    ? `${latestDateShort}${latestTime ? ` · ${latestTime}` : ''}`
    : latestTime || '';

  const result = {
    totalContacts,
    totalCallAttempts,
    entries,
    firstNoteEntry,
    careEntries,
    latestDateShort,
    latestTime,
    latestSummary,
  };

  if (rec && typeof rec === 'object') {
    contactLogsCache.set(rec, { sig: cacheSig, result });
  }

  return result;
}

const QUICK_CARE_CHIPS = [
  '2c knm, đã nt zl care',
  '3c thuê bao',
  'Khách bận, hẹn gọi lại',
  'Đã tư vấn, khách suy nghĩ thêm',
  'Đã nhắc lịch, khách chốt qua đúng giờ',
];

export function renderNoteTimelineBlock(rec, isCard = false, options = {}) {
  const log = analyzeContactLogs(rec);
  const isCareBoxOpen = state.activeCareInputId === rec.id;
  const nextStepNum = log.totalContacts + 1;
  const isAdmin = Boolean(options?.isAdmin ?? state.currentUser?.role === 'admin');
  const isTelesale = !isAdmin && state.currentUser?.role === 'telesale';
  const hasFirstNote = Boolean(String(rec?.noteM || '').trim());
  const isFirstNoteReadonly = isTelesale && hasFirstNote;

  const composerHtml = isCareBoxOpen
    ? `
      <div class="quick-care-composer">
        <div class="quick-care-header">
          <div class="quick-care-title">
            <span class="quick-care-step-pill">Lần ${nextStepNum}</span>
            <span>Ghi chú liên hệ mới · Tự gắn giờ <code>${escapeHtml(formatNowVnStamp())}</code></span>
          </div>
          <button
            type="button"
            class="btn-close-care-inline"
            data-toggle-care="${escapeHtml(rec.id)}"
            title="Đóng khung ghi chú"
          >✕ Đóng</button>
        </div>
        <div class="quick-care-chips">
          ${QUICK_CARE_CHIPS.map(
            (chip) => `
            <button
              type="button"
              class="quick-care-chip"
              data-care-chip="${escapeHtml(rec.id)}"
              data-chip-text="${escapeHtml(chip)}"
            >+ ${escapeHtml(chip)}</button>
          `
          ).join('')}
        </div>
        <div class="quick-care-input-row">
          <input
            type="text"
            class="quick-care-input"
            id="care-input-${escapeHtml(rec.id)}"
            data-care-input="${escapeHtml(rec.id)}"
            placeholder="Nhập kết quả gọi Lần ${nextStepNum} (Enter để lưu nhanh)..."
          />
          <button
            type="button"
            class="btn-save-care-inline"
            data-save-care="${escapeHtml(rec.id)}"
          >✓ Lưu Lần ${nextStepNum}</button>
        </div>
      </div>
    `
    : '';

  return `
    <div class="note-tracker-wrap ${isCard ? 'is-card-note' : ''} ${isAdmin ? 'is-admin-note-wrap' : ''}">
      <div class="note-meta-bar">
        <div class="note-meta-badges">
          ${
            log.totalContacts > 0
              ? `
            <span class="note-count-badge has-contacts" title="Đã ghi nhận ${log.totalContacts} đợt liên hệ (Tổng khoảng ${log.totalCallAttempts} cuộc gọi)">
              📞 Đã LH <strong>${log.totalContacts} lần</strong>${
                  log.totalCallAttempts > log.totalContacts
                    ? ` <em>(${log.totalCallAttempts} cuộc)</em>`
                    : ''
                }
            </span>
            ${
              log.latestSummary
                ? `<span class="note-latest-badge" title="Ngày giờ liên hệ gần nhất">
                    🕒 Gần nhất: <strong>${escapeHtml(log.latestSummary)}</strong>
                  </span>`
                : ''
            }
          `
              : `
            <span class="note-count-badge is-zero">⚪ Chưa LH (0 lần)</span>
          `
          }
        </div>
      </div>

      <div class="note-primary-box">
        ${
          log.firstNoteEntry
            ? `
          <div class="note-step-header">
            <div class="note-step-badges">
              <span class="care-attempt-badge is-first">Lần 1</span>
              ${
                log.firstNoteEntry.dateShort
                  ? `<span class="care-date-badge" title="${
                      log.firstNoteEntry.isInferredDate
                        ? 'Ngày liên hệ theo Ngày Data'
                        : 'Ngày liên hệ ghi trong Note'
                    }">📅 ${escapeHtml(log.firstNoteEntry.dateShort)}</span>`
                  : ''
              }
              ${
                log.firstNoteEntry.timeLabel
                  ? `<span class="care-time-badge">⏰ ${escapeHtml(log.firstNoteEntry.timeLabel)}</span>`
                  : ''
              }
              ${
                log.firstNoteEntry.callCount > 1
                  ? `<span class="care-calls-badge">${log.firstNoteEntry.callCount} cuộc</span>`
                  : ''
              }
            </div>
            ${
              isFirstNoteReadonly
                ? `<span class="note-locked-badge" title="Ghi chú đã lưu. Bấm 'Thêm ghi chú' để thêm mới hoặc nhờ Admin sửa nếu ghi nhầm.">🔒 Đã khóa sửa</span>`
                : ''
            }
          </div>
        `
            : ''
        }
        <textarea
          rows="${Math.min(5, Math.max(1, Math.ceil((rec.noteM || '').length / (isCard ? 34 : 36))))}"
          class="note-inline-input ${isCard ? 'card-input' : ''} ${
            isAdmin ? 'is-admin-editable' : ''
          } ${isFirstNoteReadonly ? 'is-readonly-note' : ''}"
          data-note-input="${escapeHtml(rec.id)}"
          ${
            isFirstNoteReadonly
              ? `readonly title="Chỉ Admin mới có quyền sửa ghi chú đã lưu. Vui lòng bấm 'Thêm ghi chú' để ghi lần liên hệ mới."`
              : ''
          }
          placeholder="${
            isCard
              ? 'Nhập ghi chú tư vấn (tự gắn ngày giờ)...'
              : 'Nhập ghi chú (tự gắn ngày giờ)...'
          }"
        >${escapeHtml(rec.noteM || '')}</textarea>
      </div>

      ${
        log.careEntries.length > 0
          ? `
        <div class="care-timeline-list">
          ${log.careEntries
            .map(
              (entry) => `
            <div class="care-timeline-item ${isAdmin ? 'is-admin-care-item' : ''}">
              <div class="care-timeline-header-row">
                <div class="care-timeline-badges">
                  <span class="care-attempt-badge">${escapeHtml(entry.label)}</span>
                  ${
                    entry.dateShort
                      ? `<span class="care-date-badge">📅 ${escapeHtml(entry.dateShort)}</span>`
                      : ''
                  }
                  ${
                    entry.timeLabel
                      ? `<span class="care-time-badge">⏰ ${escapeHtml(entry.timeLabel)}</span>`
                      : ''
                  }
                  ${
                    entry.callCount > 1
                      ? `<span class="care-calls-badge">${entry.callCount} cuộc</span>`
                      : ''
                  }
                </div>
              </div>
              ${
                isAdmin
                  ? `
                <input
                  type="text"
                  class="care-inline-edit-input ${isCard ? 'card-input' : ''}"
                  data-care-edit-input="${escapeHtml(rec.id)}"
                  data-care-index="${entry.careIndex}"
                  value="${escapeHtml(entry.rawText)}"
                  placeholder="Sửa nội dung ${escapeHtml(entry.label)}..."
                />
              `
                  : `<div class="care-timeline-text">${escapeHtml(entry.rawText)}</div>`
              }
            </div>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }

      ${composerHtml}

      ${
        !isCareBoxOpen
          ? `
        <button
          type="button"
          class="btn-add-care-footer"
          data-toggle-care="${escapeHtml(rec.id)}"
          title="Thêm ghi chú"
        >
          <span class="btn-add-care-footer-plus">＋</span>
          <span>Thêm ghi chú</span>
        </button>
      `
          : ''
      }
    </div>
  `;
}

export function renderRow(rec, statusOptions, telesaleList, options = {}) {
  const isNew = rec.statusGroup === 'new';
  const { dialPhone, hasValidPhone, displayPhone } = getDialPhone(rec);
  const isoApptDate = vnDateToIso(rec.apptDate);
  const tone = escapeHtml(rec.badgeColor || 'slate');
  const isAdmin = Boolean(options?.isAdmin ?? state.currentUser?.role === 'admin');

  return `
    <tr class="${isNew ? 'is-new-lead' : ''}">
      <td class="cell-date">
        <div class="cell-date-val">${escapeHtml(rec.dataDate || '—')}</div>
        ${
          isAdmin
            ? `
          <div class="admin-date-row-wrap">
            <button
              type="button"
              class="btn-delete-lead-single"
              data-delete-customer="${escapeHtml(rec.id)}"
              title="Xóa khách hàng này khỏi CRM & Google Sheet (Chỉ Admin)"
            >
              🗑️ Xóa
            </button>
          </div>
        `
            : ''
        }
      </td>

      <td class="cell-customer">
        <div class="customer-name" data-edit-record="${escapeHtml(rec.id)}">
          ${escapeHtml(rec.name || 'Khách chưa rõ tên')}
        </div>
        ${
          rec.service || rec.customerInfo
            ? `
          <div class="customer-meta">
            ${rec.service ? `<span class="service-text">${escapeHtml(rec.service)}</span>` : ''}
            ${rec.service && rec.customerInfo ? `<span class="meta-sep">·</span>` : ''}
            ${rec.customerInfo ? `<span class="info-text">${escapeHtml(rec.customerInfo)}</span>` : ''}
          </div>
        `
            : ''
        }
      </td>

      <td class="cell-phone">
        <div class="phone-num">${escapeHtml(displayPhone)}</div>
        ${
          hasValidPhone
            ? `
          <div class="phone-quick-links">
            <a href="tel:${escapeHtml(dialPhone)}" class="phone-link">Gọi</a>
            <span class="link-dot">·</span>
            <a href="https://zalo.me/${escapeHtml(
              dialPhone
            )}" target="_blank" rel="noopener noreferrer" class="phone-link">Zalo</a>
            <span class="link-dot">·</span>
            <button type="button" class="phone-link" data-copy="${escapeHtml(
              dialPhone
            )}">Copy</button>
          </div>
        `
            : `
          <div class="phone-quick-links">
            <span class="phone-link is-disabled">Chưa có số</span>
          </div>
        `
        }
        ${
          isAdmin
            ? `
          <div class="admin-tele-row-wrap">
            <button
              type="button"
              class="btn-send-tele-single"
              data-send-telegram-customer="${escapeHtml(rec.id)}"
              title="Gửi thông tin khách này vào nhóm Telegram (Chỉ Admin)"
            >
              📨 Gửi Telegram
            </button>
          </div>
        `
            : ''
        }
      </td>

      <td class="cell-status">
        <select
          class="pill-select pill-${tone}"
          data-status-select="${escapeHtml(rec.id)}"
        >
          ${renderStatusSelectOptions(rec, statusOptions, isAdmin)}
        </select>
      </td>

      <td class="cell-appt">
        <div class="appt-picker-group">
          <input
            type="date"
            class="inline-date-picker ${isoApptDate ? 'has-date' : ''}"
            data-date-picker="${escapeHtml(rec.id)}"
            value="${escapeHtml(isoApptDate)}"
          />
          <input
            type="text"
            class="inline-time-input"
            data-time-input="${escapeHtml(rec.id)}"
            placeholder="Giờ hẹn"
            title="${escapeHtml(rec.apptTime || 'Giờ hẹn')}"
            value="${escapeHtml(rec.apptTime || '')}"
          />
        </div>
      </td>

      <td class="cell-telesale">
        <select
          class="telesale-select-clean ${rec.telesale ? 'has-staff' : ''}"
          data-telesale-select="${escapeHtml(rec.id)}"
        >
          ${renderTelesaleSelectOptions(rec.telesale, telesaleList)}
        </select>
      </td>

      <td class="cell-note">
        ${renderNoteTimelineBlock(rec, false, options)}
      </td>
    </tr>
  `;
}

export function renderCard(rec, statusOptions, telesaleList, options = {}) {
  const isNew = rec.statusGroup === 'new';
  const { dialPhone, hasValidPhone, displayPhone } = getDialPhone(rec);
  const isoApptDate = vnDateToIso(rec.apptDate);
  const tone = escapeHtml(rec.badgeColor || 'slate');
  const isAdmin = Boolean(options?.isAdmin ?? state.currentUser?.role === 'admin');

  return `
    <div class="lead-card ${isNew ? 'is-new-lead' : ''}">
      <div class="card-top">
        <div class="card-customer">
          <div class="customer-name" data-edit-record="${escapeHtml(rec.id)}">
            ${escapeHtml(rec.name || 'Khách chưa rõ tên')}
          </div>
          <div class="customer-meta">
            <span class="card-date-tag">${escapeHtml(rec.dataDate || '—')}</span>
            ${rec.service ? `<span class="service-text">· ${escapeHtml(rec.service)}</span>` : ''}
            ${rec.customerInfo ? `<span class="info-text">· ${escapeHtml(rec.customerInfo)}</span>` : ''}
          </div>
        </div>
        <div class="card-top-actions">
          ${
            isAdmin
              ? `
            <button
              type="button"
              class="btn-send-tele-single is-card-btn"
              data-send-telegram-customer="${escapeHtml(rec.id)}"
              title="Gửi thông tin khách này vào nhóm Telegram (Chỉ Admin)"
            >
              📨 Gửi Telegram
            </button>
            <button
              type="button"
              class="btn-delete-lead-single is-card-btn"
              data-delete-customer="${escapeHtml(rec.id)}"
              title="Xóa khách hàng này khỏi CRM & Google Sheet (Chỉ Admin)"
            >
              🗑️ Xóa
            </button>
          `
              : ''
          }
          <button type="button" class="btn-card-edit" data-edit-record="${escapeHtml(rec.id)}">
            Sửa
          </button>
        </div>
      </div>

      <div class="card-phone-bar">
        <span class="card-phone-number">${escapeHtml(displayPhone)}</span>
        ${
          hasValidPhone
            ? `
          <div class="card-phone-actions">
            <a href="tel:${escapeHtml(dialPhone)}" class="mobile-action-btn mobile-call-btn">Gọi</a>
            <a href="https://zalo.me/${escapeHtml(
              dialPhone
            )}" target="_blank" rel="noopener noreferrer" class="mobile-action-btn mobile-zalo-btn">Zalo</a>
            <button type="button" class="mobile-action-btn mobile-copy-btn" data-copy="${escapeHtml(
              dialPhone
            )}">Copy</button>
          </div>
        `
            : `
          <div class="card-phone-actions is-disabled">
            <button type="button" class="mobile-action-btn mobile-call-btn is-disabled" disabled>Gọi</button>
            <button type="button" class="mobile-action-btn mobile-zalo-btn is-disabled" disabled>Zalo</button>
            <button type="button" class="mobile-action-btn mobile-copy-btn is-disabled" disabled>Copy</button>
          </div>
        `
        }
      </div>

      <div class="card-grid-2">
        <div class="card-field">
          <span class="card-field-label">Tình trạng</span>
          <select
            class="pill-select card-select pill-${tone}"
            data-status-select="${escapeHtml(rec.id)}"
          >
            ${renderStatusSelectOptions(rec, statusOptions, isAdmin)}
          </select>
        </div>

        <div class="card-field">
          <span class="card-field-label">Telesale</span>
          <select
            class="telesale-select-clean card-select ${rec.telesale ? 'has-staff' : ''}"
            data-telesale-select="${escapeHtml(rec.id)}"
          >
            ${renderTelesaleSelectOptions(rec.telesale, telesaleList)}
          </select>
        </div>
      </div>

      <div class="card-grid-appt">
        <div class="card-field">
          <span class="card-field-label">Ngày hẹn</span>
          <input
            type="date"
            class="inline-date-picker card-input ${isoApptDate ? 'has-date' : ''}"
            data-date-picker="${escapeHtml(rec.id)}"
            value="${escapeHtml(isoApptDate)}"
          />
        </div>
        <div class="card-field">
          <span class="card-field-label">Giờ hẹn</span>
          <input
            type="text"
            class="inline-time-input card-input"
            data-time-input="${escapeHtml(rec.id)}"
            placeholder="VD: 9h, 14h"
            value="${escapeHtml(rec.apptTime || '')}"
          />
        </div>
      </div>

      <div class="card-field">
        <span class="card-field-label">Ghi chú & Lịch sử liên hệ</span>
        ${renderNoteTimelineBlock(rec, true, options)}
      </div>
    </div>
  `;
}

export function renderQueueItem(rec, isSelected) {
  const { displayPhone } = getDialPhone(rec);
  return `
    <div class="queue-item ${isSelected ? 'active' : ''}" data-select-record="${escapeHtml(rec.id)}">
      <div>${escapeHtml(rec.name || 'Khách chưa rõ tên')}</div>
      <div>${escapeHtml(displayPhone)}</div>
      <div>${escapeHtml(rec.telesale || '')}</div>
    </div>
  `;
}

export function renderCockpitDetail(rec) {
  if (!rec) return '';
  const { dialPhone } = getDialPhone(rec);
  const isoApptDate = vnDateToIso(rec.apptDate);
  return `
    <div>
      <a href="tel:${escapeHtml(dialPhone)}">Gọi</a>
      <a href="https://zalo.me/${escapeHtml(dialPhone)}">Zalo</a>
      <button data-cockpit-status="ĐẶT HẸN"></button>
      <button data-cockpit-telesale="${escapeHtml(rec.telesale || '')}"></button>
      <input type="date" data-date-picker="${escapeHtml(rec.id)}" value="${escapeHtml(isoApptDate)}" />
      <button data-quick-time="${escapeHtml(rec.apptTime || '')}"></button>
      <textarea data-cockpit-notem="${escapeHtml(rec.id)}"></textarea>
      <input data-custinfo-input="${escapeHtml(rec.id)}" />
    </div>
  `;
}

export function parseMessengerLeadText(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) {
    return { name: '', phone: '', service: '', fbLink: '', customerInfo: '' };
  }

  let fbLink = '';
  const fbMatch = text.match(
    /https?:\/\/(?:www\.|m\.|mbasic\.|web\.)?(?:facebook\.com|fb\.com)\/\S+/i
  );
  if (fbMatch) {
    fbLink = fbMatch[0].replace(/[),.]+$/, '');
  }

  let phone = '';
  const textWithoutUrls = text.replace(/https?:\/\/\S+/gi, ' ');
  const phoneMatch = textWithoutUrls.match(/(?:\+?84|0)\d(?:[\s.\-]?\d){8,9}\b/);
  if (phoneMatch) {
    let digits = phoneMatch[0].replace(/\D/g, '');
    if (digits.startsWith('84') && digits.length === 11) {
      digits = `0${digits.slice(2)}`;
    }
    phone = digits;
  }

  let service = '';
  const lower = text.toLocaleLowerCase('vi-VN');
  if (lower.includes('999') || lower.includes('nâng cơ')) {
    service = 'Nâng cơ 999k';
  } else if (lower.includes('1tr999') || lower.includes('1.999') || lower.includes('1999')) {
    service = 'Mũi sợi 1tr999';
  } else if (lower.includes('2tr999') || lower.includes('2.999') || lower.includes('2999')) {
    service = 'Mũi sợi 2tr999';
  }

  let name = '';
  const nameLineMatch = textWithoutUrls.match(
    /(?:tên(?:\s*kh(?:ách)?)?|khách(?:\s*hàng)?|họ\s*tên)\s*[:\-]\s*([^\n,;0-9]{2,40})/i
  );
  if (nameLineMatch) {
    name = nameLineMatch[1].trim();
  } else {
    const honorificMatch = textWithoutUrls.match(
      /\b((?:chị|anh|cô|chú|bác|em|khách)\s+[A-ZÀ-Ỹa-zà-ỹ]+(?:\s+[A-ZÀ-Ỹa-zà-ỹ]+){0,3})/
    );
    if (honorificMatch) {
      name = honorificMatch[1].trim();
    }
  }

  const cleanedNotes = text
    .replace(fbLink, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ');

  return {
    name,
    phone,
    service,
    fbLink,
    customerInfo: cleanedNotes || text,
  };
}

const REVENUE_PRESET_AMOUNTS = [
  { value: '999.000', label: '999k (Nâng cơ)' },
  { value: '1.999.000', label: '1tr999 (Mũi sợi)' },
  { value: '2.999.000', label: '2tr999 (Mũi sợi)' },
  { value: '5.000.000', label: '5.000.000' },
  { value: '10.000.000', label: '10.000.000' },
  { value: '15.000.000', label: '15.000.000' },
];

export function renderAddLeadModal(data = {}) {
  const todayIso = getLocalIsoDate(0);
  const serviceOptions =
    Array.isArray(data.serviceOptions) && data.serviceOptions.length > 0
      ? data.serviceOptions
      : ['Nâng cơ 999k', 'Mũi sợi 1tr999', 'Mũi sợi 2tr999'];
  const sourceOptions =
    Array.isArray(data.sourceOptions) && data.sourceOptions.length > 0
      ? data.sourceOptions
      : ['Ads FB Mess', 'Giới thiệu', 'Gọi điện trực tiếp', 'Google'];
  const statusOptions = Array.isArray(data.statusOptions) ? data.statusOptions : [];
  const telesaleList = Array.isArray(data.telesaleList) ? data.telesaleList : [];

  return `
    <div class="modal-overlay" id="add-lead-modal-overlay">
      <div class="modal-card modal-card-wide add-lead-modal-card" onclick="event.stopPropagation()">
        <div class="modal-header add-lead-modal-header">
          <div class="modal-header-main">
            <span class="modal-header-title">➕ Thêm Khách Hàng Mới</span>
          </div>
          <button type="button" class="btn-clean" id="btn-close-add-lead">✕</button>
        </div>

        <form id="add-lead-form" class="modal-body add-lead-form-body">
          <div class="field-row-3">
            <div class="field-group">
              <label for="add-lead-datadate">Ngày thêm data *</label>
              <input
                type="date"
                id="add-lead-datadate"
                value="${escapeHtml(todayIso)}"
                required
              />
            </div>

            <div class="field-group">
              <label for="add-lead-name">Tên khách hàng *</label>
              <input
                type="text"
                id="add-lead-name"
                placeholder="VD: Chị Nguyễn Thị Lan"
                required
              />
            </div>

            <div class="field-group">
              <label for="add-lead-phone">Số điện thoại *</label>
              <input
                type="tel"
                id="add-lead-phone"
                placeholder="VD: 0912345678"
                required
              />
            </div>
          </div>

          <div class="field-row-2">
            <div class="field-group">
              <label for="add-lead-service-select">Loại dịch vụ *</label>
              <select id="add-lead-service-select">
                ${serviceOptions
                  .map(
                    (svc) =>
                      `<option value="${escapeHtml(svc)}">${escapeHtml(svc)}</option>`
                  )
                  .join('')}
                <option value="__OTHER__">Khác (Tự điền)...</option>
              </select>
              <input
                type="text"
                id="add-lead-service-custom"
                class="custom-other-input is-hidden"
                placeholder="Nhập loại dịch vụ khác..."
              />
            </div>

            <div class="field-group">
              <label for="add-lead-source-select">Nguồn *</label>
              <select id="add-lead-source-select">
                ${sourceOptions
                  .map(
                    (src, idx) =>
                      `<option value="${escapeHtml(src)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(
                        src
                      )}</option>`
                  )
                  .join('')}
                <option value="__OTHER__">Khác (Tự điền)...</option>
              </select>
              <input
                type="text"
                id="add-lead-source-custom"
                class="custom-other-input is-hidden"
                placeholder="Nhập nguồn khách khác..."
              />
            </div>
          </div>

          <div class="field-group">
            <label for="add-lead-fblink">Link Facebook</label>
            <input
              type="text"
              id="add-lead-fblink"
              placeholder="VD: https://www.facebook.com/..."
            />
          </div>

          <div class="field-group">
            <label for="add-lead-custinfo">Note từ tư vấn</label>
            <textarea
              id="add-lead-custinfo"
              rows="2"
              placeholder="Nhập nội dung tư vấn từ Messenger..."
            ></textarea>
          </div>

          <div class="field-row-3">
            <div class="field-group">
              <label for="add-lead-status">Tình trạng</label>
              <select id="add-lead-status">
                ${statusOptions
                  .map(
                    (opt) =>
                      `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`
                  )
                  .join('')}
              </select>
            </div>

            <div class="field-group">
              <label for="add-lead-apptdate">Ngày hẹn</label>
              <input
                type="date"
                id="add-lead-apptdate"
              />
            </div>

            <div class="field-group">
              <label for="add-lead-appttime">Giờ hẹn</label>
              <input
                type="text"
                id="add-lead-appttime"
                placeholder="VD: 09:30, 14h"
              />
            </div>
          </div>

          <div class="field-row-2">
            <div class="field-group">
              <label for="add-lead-telesale">Telesale phụ trách</label>
              <select id="add-lead-telesale">
                ${renderTelesaleSelectOptions('', telesaleList)}
              </select>
            </div>

            <div class="field-group">
              <label for="add-lead-notem">Ghi chú Telesale</label>
              <input
                type="text"
                id="add-lead-notem"
                placeholder="Ghi chú thêm (nếu có)..."
              />
            </div>
          </div>

          <div class="field-group admin-revenue-box is-hidden" id="add-lead-revenue-wrap">
            <label for="add-lead-revenue">💰 Doanh số thực thu (VNĐ)</label>
            <div class="quick-care-chips">
              ${REVENUE_PRESET_AMOUNTS.map(
                (p) =>
                  `<button type="button" class="quick-care-chip" data-add-lead-rev-chip="${escapeHtml(
                    p.value
                  )}">+ ${escapeHtml(p.label)}</button>`
              ).join('')}
            </div>
            <input
              type="text"
              id="add-lead-revenue"
              placeholder="Nhập số tiền doanh số (VD: 2.999.000)..."
            />
          </div>

          <div class="modal-footer">
            <div></div>
            <div class="modal-footer-right">
              <button type="button" class="btn-clean" id="btn-cancel-add-lead">Hủy</button>
              <button type="submit" class="btn-clean btn-primary-clean" id="btn-submit-add-lead">
                💾 Lưu Khách Hàng
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderArrivedRevenueModal(data = {}, modalInfo = {}) {
  const rec = modalInfo?.record || findRecord(modalInfo?.recordId);
  if (!rec) return '';
  const displayPhone = rec.phoneDisplay || rec.phone || rec.rawPhone || '—';

  return `
    <div class="modal-overlay" id="arrived-modal-overlay">
      <div class="modal-card arrived-revenue-modal-card" onclick="event.stopPropagation()">
        <div class="modal-header arrived-modal-header">
          <div class="modal-header-main">
            <span class="modal-header-title">✅ Xác Nhận Khách Đã Đến & Ghi Doanh Số</span>
          </div>
          <button type="button" class="btn-clean" id="btn-close-arrived-modal">✕</button>
        </div>

        <form id="arrived-revenue-form" class="modal-body">
          <div class="arrived-customer-summary">
            <div>
              <strong>👤 Khách hàng:</strong> ${escapeHtml(rec.name || 'Khách hàng')} · <code>${escapeHtml(
                displayPhone
              )}</code>
            </div>
            <div>
              <strong>💆 Dịch vụ:</strong> ${escapeHtml(rec.service || '—')} · <strong>👩‍💼 Telesale:</strong> ${escapeHtml(
                rec.telesale || 'Chưa phân bổ'
              )}
            </div>
          </div>

          <div class="field-group admin-revenue-box">
            <label for="arrived-revenue-input">💰 Doanh số thực thu (VNĐ) *</label>
            <div class="quick-care-chips">
              ${REVENUE_PRESET_AMOUNTS.map(
                (p) =>
                  `<button type="button" class="quick-care-chip" data-arrived-rev-chip="${escapeHtml(
                    p.value
                  )}">+ ${escapeHtml(p.label)}</button>`
              ).join('')}
              <button type="button" class="quick-care-chip" data-arrived-rev-chip="0">0 VNĐ (Tư vấn / Chưa thu)</button>
            </div>
            <input
              type="text"
              id="arrived-revenue-input"
              placeholder="Nhập doanh số thực thu (VD: 2.999.000 hoặc 13000000)..."
              value="${escapeHtml(modalInfo?.defaultRevenue || '')}"
              required
            />
          </div>

          <div class="modal-footer">
            <div></div>
            <div class="modal-footer-right">
              <button type="button" class="btn-clean" id="btn-cancel-arrived-modal">Hủy</button>
              <button type="submit" class="btn-clean btn-primary-clean" id="btn-confirm-arrived-revenue">
                ✅ Xác Nhận & Lưu Doanh Số
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEditModal(data) {
  const rec = findRecord(state.editingRecordId);
  if (!rec) return '';
  const isoApptDate = vnDateToIso(rec.apptDate);
  const displayPhone = rec.phoneDisplay || rec.phone || rec.rawPhone || '';
  const log = analyzeContactLogs(rec);
  const nextStepNum = log.totalContacts + 1;
  const isAdmin = state.currentUser?.role === 'admin';
  const isTelesale = !isAdmin && state.currentUser?.role === 'telesale';
  const hasFirstNote = Boolean(String(rec.noteM || '').trim());
  const isFirstNoteReadonly = isTelesale && hasFirstNote;
  const isCurrentlyArrived =
    rec.statusGroup === 'arrived' || isArrivedStatusValue(rec.status || rec.canonicalStatus);

  return `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-card modal-card-wide" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-header-main">
            <span class="modal-header-title">${escapeHtml(rec.name || 'Khách hàng')}${
              displayPhone ? ` · ${escapeHtml(displayPhone)}` : ''
            }</span>
            <span class="note-count-badge ${log.totalContacts > 0 ? 'has-contacts' : 'is-zero'}">
              ${
                log.totalContacts > 0
                  ? `📞 Đã LH ${log.totalContacts} lần (${log.totalCallAttempts} cuộc)${
                      log.latestSummary ? ` · Gần nhất: ${escapeHtml(log.latestSummary)}` : ''
                    }`
                  : '⚪ Chưa có lịch sử liên hệ'
              }
            </span>
          </div>
          <button class="btn-clean" id="btn-close-modal">✕</button>
        </div>

        <div class="modal-body">
          <div class="field-row-2">
            <div class="field-group">
              <label>Tình trạng</label>
              <select id="modal-status">
                ${renderStatusSelectOptions(rec, data.statusOptions || [], isAdmin)}
              </select>
            </div>
            <div class="field-group">
              <label>Telesale phụ trách</label>
              <select id="modal-telesale">
                ${renderTelesaleSelectOptions(rec.telesale, data.telesaleList || [])}
              </select>
            </div>
          </div>

          ${
            isAdmin
              ? `
            <div class="field-group admin-revenue-box ${
              isCurrentlyArrived ? '' : 'is-hidden'
            }" id="modal-revenue-wrap">
              <label for="modal-revenue">💰 Doanh số thực thu (VNĐ)</label>
              <div class="quick-care-chips">
                ${REVENUE_PRESET_AMOUNTS.map(
                  (p) =>
                    `<button type="button" class="quick-care-chip" data-modal-rev-chip="${escapeHtml(
                      p.value
                    )}">+ ${escapeHtml(p.label)}</button>`
                ).join('')}
              </div>
              <input
                type="text"
                id="modal-revenue"
                placeholder="Nhập doanh số thực thu (VD: 2.999.000)..."
              />
            </div>
          `
              : ''
          }

          <div class="field-group">
            <label>Note từ tư vấn</label>
            <input
              type="text"
              id="modal-custinfo"
              placeholder="VD: Chị Vân 1970, Biên Hoà"
              value="${escapeHtml(rec.customerInfo || '')}"
            />
          </div>

          <div class="field-row-2">
            <div class="field-group">
              <label>Ngày hẹn</label>
              <input
                type="date"
                id="modal-apptdate"
                value="${escapeHtml(isoApptDate)}"
              />
            </div>
            <div class="field-group">
              <label>Giờ hẹn</label>
              <input
                type="text"
                id="modal-appttime"
                placeholder="VD: 9h, 14h"
                value="${escapeHtml(rec.apptTime || '')}"
              />
            </div>
          </div>

          <div class="field-group">
            <div class="modal-field-label-row">
              <label>Ghi chú gốc (Lần 1)</label>
              ${
                isFirstNoteReadonly
                  ? `<span class="note-locked-badge">🔒 Chỉ Admin mới sửa được ghi chú đã lưu</span>`
                  : ''
              }
            </div>
            <textarea
              id="modal-notem"
              ${isFirstNoteReadonly ? 'readonly class="is-readonly-note"' : ''}
              placeholder="Nhập ghi chú tư vấn lần 1..."
            >${escapeHtml(rec.noteM || '')}</textarea>
          </div>

          ${
            log.careEntries.length > 0
              ? `
            <div class="field-group">
              <label>Lịch sử các lần liên hệ tiếp theo (${log.careEntries.length} lần Care)</label>
              <div class="care-timeline-list is-modal-timeline" id="modal-care-list">
                ${log.careEntries
                  .map(
                    (entry) => `
                  <div class="care-timeline-item ${
                    isAdmin ? 'is-admin-care-item' : ''
                  }" data-modal-care-row="${entry.careIndex}">
                    <div class="care-timeline-header-row">
                      <div class="care-timeline-badges">
                        <span class="care-attempt-badge">${escapeHtml(entry.label)}</span>
                        ${
                          entry.dateShort
                            ? `<span class="care-date-badge">📅 ${escapeHtml(entry.dateShort)}</span>`
                            : ''
                        }
                        ${
                          entry.timeLabel
                            ? `<span class="care-time-badge">⏰ ${escapeHtml(entry.timeLabel)}</span>`
                            : ''
                        }
                        ${
                          entry.callCount > 1
                            ? `<span class="care-calls-badge">${entry.callCount} cuộc</span>`
                            : ''
                        }
                      </div>
                    </div>
                    ${
                      isAdmin
                        ? `
                      <input
                        type="text"
                        class="care-inline-edit-input"
                        data-modal-care-input="${entry.careIndex}"
                        value="${escapeHtml(entry.rawText)}"
                        placeholder="Nội dung ${escapeHtml(entry.label)}..."
                      />
                    `
                        : `<div class="care-timeline-text">${escapeHtml(entry.rawText)}</div>`
                    }
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }

          <div class="field-group modal-new-care-box">
            <label>➕ Ghi thêm Lần liên hệ thứ ${nextStepNum} (Tự động gắn ngày giờ <code>${escapeHtml(
              formatNowVnStamp()
            )}</code>)</label>
            <div class="quick-care-chips">
              ${QUICK_CARE_CHIPS.map(
                (chip) => `
                <button
                  type="button"
                  class="quick-care-chip"
                  data-modal-care-chip="${escapeHtml(chip)}"
                >+ ${escapeHtml(chip)}</button>
              `
              ).join('')}
            </div>
            <input
              type="text"
              id="modal-new-care"
              placeholder="Nhập kết quả gọi Lần ${nextStepNum} hoặc bấm nút gợi ý ở trên..."
            />
          </div>
        </div>

        <div class="modal-footer">
          ${
            isAdmin
              ? `
            <div class="modal-footer-left">
              <button
                type="button"
                class="btn-send-tele-single is-modal-btn"
                data-send-telegram-customer="${escapeHtml(rec.id)}"
                title="Gửi thông tin lịch hẹn của khách hàng này vào nhóm Telegram (Chỉ Admin)"
              >
                📨 Gửi Telegram
              </button>
              <button
                type="button"
                class="btn-delete-lead-single is-modal-btn"
                data-delete-customer="${escapeHtml(rec.id)}"
                title="Xóa khách hàng này khỏi CRM & Google Sheet (Chỉ Admin)"
              >
                🗑️ Xóa Data
              </button>
            </div>
          `
              : '<div></div>'
          }
          <div class="modal-footer-right">
            <button class="btn-clean" id="btn-cancel-modal">Hủy</button>
            <button class="btn-clean btn-primary-clean" id="btn-save-modal">Lưu thay đổi</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function quickSave(recordId, updates, msg, appendCareNoteText = '') {
  const rec = findRecord(recordId);
  if (!rec) return;
  try {
    const res = await saveCustomerInteraction({
      sheetKey: rec.sheetKey,
      sheetRowIndex: rec.sheetRowIndex,
      phone: rec.phone,
      name: rec.name,
      updates,
      appendCareNoteText,
    });
    state.crmData = res.crmData;
    notify(msg || 'Đã lưu');
    render();
  } catch (err) {
    if (err.requireAuth) {
      state.currentUser = null;
      render();
      return;
    }
    notify(`Lỗi: ${err.message}`);
  }
}

async function resolveAdminOverviewSafe() {
  const query = {
    period: state.overviewPeriod,
    from: state.overviewCustomFrom,
    to: state.overviewCustomTo,
  };
  try {
    const ov = await fetchAdminOverview(query);
    if (
      ov?.ok &&
      (ov.marketing?.cost > 0 || ov.marketing?.received > 0 || ov.crm?.revenue > 0)
    ) {
      return ov;
    }
  } catch {
    // Fallback to client-side overview calculation
  }
  const { buildClientAdminOverview } = await import('./core/admin-overview-client.js');
  return buildClientAdminOverview({ ...query, crmData: state.crmData });
}

async function loadAdminOverview() {
  if (state.currentUser?.role !== 'admin') return;
  state.overviewLoading = true;
  render();
  try {
    state.adminOverview = await resolveAdminOverviewSafe();
  } catch (err) {
    notify(`Lỗi tải Tổng quan CEO: ${err.message}`);
  } finally {
    state.overviewLoading = false;
    render();
  }
}

async function loadAuthenticatedWorkspace() {
  state.loading = true;
  render();
  try {
    state.crmData = await fetchCrmData(false);
    state.loading = false;
    render();
    if (state.currentUser?.role === 'admin') {
      Promise.all([
        fetchAdminUsers().catch(() => []),
        resolveAdminOverviewSafe().catch(() => null),
        fetchTelegramSchedule().catch(() => null),
      ]).then(([users, overview, teleSched]) => {
        state.adminUsers = users;
        if (overview) state.adminOverview = overview;
        if (teleSched) state.telegramSchedule = teleSched;
        render();
      });
    }
  } catch (err) {
    state.loading = false;
    if (err.requireAuth) {
      state.currentUser = null;
    } else {
      notify(`Lỗi tải dữ liệu: ${err.message}`);
    }
    render();
  }
}

function bindLoginEvents() {
  const toggleBtn = document.getElementById('btn-toggle-login-pass');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const uVal = document.getElementById('login-username')?.value || '';
      const pVal = document.getElementById('login-password')?.value || '';
      state.showLoginPassword = !state.showLoginPassword;
      render();
      const uEl = document.getElementById('login-username');
      const pEl = document.getElementById('login-password');
      if (uEl) uEl.value = uVal;
      if (pEl) {
        pEl.value = pVal;
        pEl.focus();
      }
    });
  }

  const form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username')?.value?.trim() || '';
      const password = document.getElementById('login-password')?.value || '';
      state.loginError = '';
      state.loginLoading = true;
      render();

      try {
        const res = await loginUser(username, password);
        state.currentUser = res.user;
        state.loginLoading = false;
        state.loginError = '';
        state.activeTab = 'mkt';
        notify(`Xin chào ${res.user.telesaleName || res.user.username}!`);
        await loadAuthenticatedWorkspace();
      } catch (err) {
        state.loginLoading = false;
        state.loginError = err.message || 'Đăng nhập thất bại';
        render();
        const uEl = document.getElementById('login-username');
        if (uEl) uEl.value = username;
      }
    });
  }
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextTab = btn.getAttribute('data-tab');
      if ((nextTab === 'admin' || nextTab === 'overview') && state.currentUser?.role !== 'admin') {
        return;
      }
      state.activeTab = nextTab;
      if (nextTab === 'today' && !state.reminderRange) {
        state.reminderRange = 'today';
      }
      if (nextTab === 'admin' && state.currentUser?.role === 'admin') {
        try {
          const [users, teleSched] = await Promise.all([
            fetchAdminUsers(),
            fetchTelegramSchedule().catch(() => state.telegramSchedule),
          ]);
          state.adminUsers = users;
          if (teleSched) state.telegramSchedule = teleSched;
        } catch (err) {
          notify(`Lỗi tải danh sách tài khoản: ${err.message}`);
        }
      }
      if (nextTab === 'overview' && state.currentUser?.role === 'admin') {
        await loadAdminOverview();
        return;
      }
      state.pagination.page = 1;
      state.filters.status = 'all';
      render();
    });
  });

  document.querySelectorAll('[data-view-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.getAttribute('data-view-mode') || 'grid';
      render();
    });
  });

  document.getElementById('airtable-group-by')?.addEventListener('change', (e) => {
    state.groupBy = e.target.value || 'none';
    render();
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logoutUser();
    state.currentUser = null;
    state.crmData = null;
    state.adminUsers = [];
    state.adminOverview = null;
    state.editingUserId = null;
    state.activeTab = 'mkt';
    notify('Đã đăng xuất tài khoản');
    render();
  });

  // =========================================================================
  // SỰ KIỆN TRANG TỔNG QUAN ĐIỀU HÀNH CEO (Chỉ hoạt động khi role === 'admin')
  // =========================================================================
  if (state.currentUser?.role === 'admin' && state.activeTab === 'overview') {
    document.querySelectorAll('[data-overview-period]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const nextPeriod = btn.getAttribute('data-overview-period') || 'month';
        state.overviewPeriod = nextPeriod;
        if (nextPeriod === 'custom') {
          if (!state.overviewCustomFrom) {
            const today = getLocalIsoDate(0);
            state.overviewCustomFrom = `${today.slice(0, 7)}-01`;
            state.overviewCustomTo = today;
          }
        }
        await loadAdminOverview();
      });
    });

    document.getElementById('btn-apply-ov-custom')?.addEventListener('click', async () => {
      const fromVal = document.getElementById('ov-custom-from')?.value || '';
      const toVal = document.getElementById('ov-custom-to')?.value || '';
      if (!fromVal || !toVal || fromVal > toVal) {
        notify('Vui lòng chọn khoảng ngày hợp lệ (Từ ngày <= Đến ngày)');
        return;
      }
      state.overviewCustomFrom = fromVal;
      state.overviewCustomTo = toVal;
      state.overviewPeriod = 'custom';
      await loadAdminOverview();
    });
  }

  // =========================================================================
  // SỰ KIỆN TRANG QUẢN LÝ ADMIN (Chỉ hoạt động khi role === 'admin')
  // =========================================================================
  document.querySelectorAll('[data-open-admin-tele]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.currentUser?.role !== 'admin') return;
      state.activeTab = 'admin';
      render();
      try {
        const [users, teleSched] = await Promise.all([
          fetchAdminUsers().catch(() => state.adminUsers),
          fetchTelegramSchedule().catch(() => state.telegramSchedule),
        ]);
        state.adminUsers = users;
        if (teleSched) state.telegramSchedule = teleSched;
        render();
      } catch {
        // ignore
      }
    });
  });

  if (state.currentUser?.role === 'admin' && state.activeTab === 'admin') {
    document.getElementById('btn-toggle-tele-auto')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const curEnabled = btn.getAttribute('data-tele-enabled') !== 'false';
      const nextEnabled = !curEnabled;
      const timeVal =
        document.getElementById('admin-tele-send-time')?.value ||
        state.telegramSchedule?.sendTime ||
        '08:00';
      btn.disabled = true;
      try {
        const updated = await updateTelegramSchedule({
          enabled: nextEnabled,
          sendTime: timeVal,
        });
        state.telegramSchedule = updated;
        notify(
          nextEnabled
            ? `Đã BẬT tự động báo lịch Telegram lúc ${updated.sendTime} mỗi ngày`
            : 'Đã TẮT tự động báo lịch Telegram'
        );
        render();
      } catch (err) {
        btn.disabled = false;
        notify(`Lỗi lưu cài đặt Telegram: ${err.message}`);
      }
    });

    document.getElementById('btn-save-tele-schedule')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const timeVal = document.getElementById('admin-tele-send-time')?.value?.trim() || '08:00';
      btn.disabled = true;
      try {
        const updated = await updateTelegramSchedule({
          sendTime: timeVal,
        });
        state.telegramSchedule = updated;
        notify(
          updated.enabled
            ? `Đã lưu giờ tự động gửi Telegram: ${updated.sendTime} mỗi ngày`
            : `Đã lưu giờ gửi (${updated.sendTime}) · Chế độ tự động hiện đang TẮT`
        );
        render();
      } catch (err) {
        btn.disabled = false;
        notify(`Lỗi lưu giờ gửi Telegram: ${err.message}`);
      }
    });

    document.querySelectorAll('[data-tele-preset]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const presetTime = chip.getAttribute('data-tele-preset') || '08:00';
        const timeInput = document.getElementById('admin-tele-send-time');
        if (timeInput) timeInput.value = presetTime;
        try {
          const updated = await updateTelegramSchedule({
            enabled: true,
            sendTime: presetTime,
          });
          state.telegramSchedule = updated;
          notify(`Đã đặt tự động báo lịch Telegram lúc ${updated.sendTime} mỗi ngày`);
          render();
        } catch (err) {
          notify(`Lỗi lưu giờ gửi: ${err.message}`);
        }
      });
    });

    document.getElementById('btn-gen-random-pass')?.addEventListener('click', () => {
      const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
      let pass = 'bsn';
      for (let i = 0; i < 4; i++) {
        pass += chars[Math.floor(Math.random() * chars.length)];
      }
      const passInput = document.getElementById('admin-input-password');
      if (passInput) passInput.value = pass;
    });

    document.getElementById('btn-cancel-edit-user')?.addEventListener('click', () => {
      state.editingUserId = null;
      render();
    });

    document.getElementById('admin-user-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('admin-input-username')?.value?.trim() || '';
      const password = document.getElementById('admin-input-password')?.value?.trim() || '';
      const telesaleName = document.getElementById('admin-input-telesale')?.value?.trim() || '';
      const role = document.getElementById('admin-input-role')?.value || 'telesale';
      const dataScope = document.getElementById('admin-input-scope')?.value || 'all';
      const canEdit = document.getElementById('admin-input-canedit')?.value !== 'false';
      const active = document.getElementById('admin-input-active')?.value !== 'false';

      const payload = {
        username,
        password,
        telesaleName,
        role,
        active,
        permissions: {
          accessCrm: active,
          canEdit,
          dataScope,
        },
      };

      const submitBtn = document.getElementById('btn-save-user');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang lưu...';
      }

      try {
        if (state.editingUserId) {
          const res = await updateAdminUser({ id: state.editingUserId, ...payload });
          state.adminUsers = res.users || [];
          state.editingUserId = null;
          notify(`Đã cập nhật tài khoản "${username}"`);
        } else {
          const res = await createAdminUser(payload);
          state.adminUsers = res.users || [];
          notify(`Đã tạo tài khoản "${username}" (${telesaleName.toUpperCase()})`);
        }
        state.crmData = await fetchCrmData(false);
        render();
      } catch (err) {
        notify(`Lỗi: ${err.message}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = state.editingUserId
            ? 'Lưu cập nhật tài khoản'
            : '+ Cấp tài khoản & Phân quyền';
        }
      }
    });

    document.querySelectorAll('[data-admin-edit-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.editingUserId = btn.getAttribute('data-admin-edit-btn');
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    document.querySelectorAll('[data-admin-toggle-active]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-admin-toggle-active');
        const nextActive = btn.getAttribute('data-next-active') === 'true';
        try {
          const res = await updateAdminUser({
            id: userId,
            active: nextActive,
            permissions: { accessCrm: nextActive },
          });
          state.adminUsers = res.users || [];
          state.crmData = await fetchCrmData(false);
          notify(nextActive ? 'Đã mở quyền truy cập CRM' : 'Đã khóa quyền truy cập CRM');
          render();
        } catch (err) {
          notify(`Lỗi: ${err.message}`);
        }
      });
    });

    document.querySelectorAll('[data-admin-scope-user]').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const userId = sel.getAttribute('data-admin-scope-user');
        try {
          const res = await updateAdminUser({
            id: userId,
            permissions: { dataScope: e.target.value },
          });
          state.adminUsers = res.users || [];
          notify('Đã cập nhật phạm vi xem dữ liệu');
          render();
        } catch (err) {
          notify(`Lỗi: ${err.message}`);
        }
      });
    });

    document.querySelectorAll('[data-admin-edit-user]').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const userId = sel.getAttribute('data-admin-edit-user');
        try {
          const res = await updateAdminUser({
            id: userId,
            permissions: { canEdit: e.target.value === 'true' },
          });
          state.adminUsers = res.users || [];
          notify('Đã cập nhật quyền thao tác');
          render();
        } catch (err) {
          notify(`Lỗi: ${err.message}`);
        }
      });
    });

    document.querySelectorAll('[data-admin-delete-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-admin-delete-btn');
        const uName = btn.getAttribute('data-admin-delete-name') || '';
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(`Bạn có chắc chắn muốn xóa tài khoản "${uName}" khỏi hệ thống?`)) {
            return;
          }
        }
        try {
          const res = await deleteAdminUser(userId);
          state.adminUsers = res.users || [];
          if (state.editingUserId === userId) state.editingUserId = null;
          state.crmData = await fetchCrmData(false);
          notify(`Đã xóa tài khoản "${uName}"`);
          render();
        } catch (err) {
          notify(`Lỗi: ${err.message}`);
        }
      });
    });
  }

  document.querySelectorAll('[data-jump-reminder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const range = btn.getAttribute('data-jump-reminder') || 'today';
      state.activeTab = 'today';
      state.reminderRange = range;
      state.pagination.page = 1;
      state.filters.status = 'all';
      render();
    });
  });

  document.querySelectorAll('[data-reminder-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.reminderRange = btn.getAttribute('data-reminder-range') || 'today';
      state.pagination.page = 1;
      render();
    });
  });

  document.querySelectorAll('[data-send-telegram]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.currentUser?.role !== 'admin') return;
      const range = btn.getAttribute('data-send-telegram') || 'today';
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Đang gửi...';
      try {
        const payload =
          state.activeTab === 'today' &&
          state.reminderRange === 'custom' &&
          state.reminderCustomDate
            ? {
                dateVn: isoToVnDate(state.reminderCustomDate),
                label: `NGÀY ${isoToVnDate(state.reminderCustomDate)}`,
              }
            : { range };
        const res = await triggerTelegramReminder(payload);
        notify(`Đã gửi lịch hẹn (${res.count || 0} khách) vào Telegram`);
      } catch (err) {
        notify(`Chưa gửi được Telegram: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });

  document.querySelectorAll('[data-send-telegram-customer]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.currentUser?.role !== 'admin') return;
      const id = btn.getAttribute('data-send-telegram-customer');
      const rec = findRecord(id);
      if (!rec) return;
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Đang gửi...';
      try {
        await triggerTelegramReminder({
          mode: 'single',
          recordId: rec.id,
          sheetKey: rec.sheetKey,
          sheetRowIndex: rec.sheetRowIndex,
        });
        notify(`Đã gửi thông tin khách "${rec.name}" vào Telegram!`);
      } catch (err) {
        notify(`Chưa gửi được Telegram: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });

  document.querySelectorAll('[data-delete-customer]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.currentUser?.role !== 'admin') {
        notify('Chỉ tài khoản Admin mới có quyền xóa Data khách hàng');
        return;
      }
      const id = btn.getAttribute('data-delete-customer');
      const rec = findRecord(id);
      if (!rec) return;

      const displayPhone = rec.phoneDisplay || rec.phone || rec.rawPhone || 'Chưa có SĐT';
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const confirmed = window.confirm(
          `Bạn có chắc chắn muốn XÓA khách hàng "${rec.name || 'Khách hàng'}" (${displayPhone})?\n\nDòng dữ liệu này sẽ bị xóa khỏi CRM và xóa trực tiếp trên Google Sheet.`
        );
        if (!confirmed) return;
      }

      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Đang xóa...';
      try {
        const res = await deleteCustomerLead({
          recordId: rec.id,
          sheetKey: rec.sheetKey,
          sheetRowIndex: rec.sheetRowIndex,
          phone: rec.phone || rec.rawPhone || '',
          name: rec.name || '',
        });
        state.crmData = res.crmData;
        if (state.editingRecordId === rec.id) {
          state.editingRecordId = null;
        }
        if (state.activeCareInputId === rec.id) {
          state.activeCareInputId = null;
        }
        notify(`🗑️ Đã xóa khách "${rec.name}" khỏi CRM & Google Sheet!`);
        render();
        resolveAdminOverviewSafe()
          .then((ov) => {
            if (ov) state.adminOverview = ov;
          })
          .catch(() => {});
      } catch (err) {
        if (err.requireAuth) {
          state.currentUser = null;
          render();
          return;
        }
        btn.disabled = false;
        btn.textContent = origText;
        notify(`Lỗi xóa khách hàng: ${err.message}`);
      }
    });
  });

  const customDateInput = document.getElementById('reminder-custom-date');
  if (customDateInput) {
    customDateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        state.reminderRange = 'custom';
        state.reminderCustomDate = e.target.value;
        state.pagination.page = 1;
        render();
      }
    });
  }

  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    state.refreshing = true;
    render();
    try {
      state.crmData = await fetchCrmData(true);
      if (state.currentUser?.role === 'admin') {
        state.adminUsers = await fetchAdminUsers().catch(() => state.adminUsers);
        state.adminOverview = await resolveAdminOverviewSafe();
      }
      notify('Đã cập nhật dữ liệu');
    } catch (err) {
      if (err.requireAuth) {
        state.currentUser = null;
      } else {
        notify(`Lỗi: ${err.message}`);
      }
    } finally {
      state.refreshing = false;
      render();
    }
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    const commitSearch = (val) => {
      state.filters.search = val;
      state.pagination.page = 1;
      render();
      const el = document.getElementById('search-input');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    };
    searchInput.addEventListener('input', (e) => {
      if (e.isComposing) return;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      const val = e.target.value;
      searchDebounceTimer = setTimeout(() => {
        commitSearch(val);
      }, 140);
    });
    searchInput.addEventListener('compositionend', (e) => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      const val = e.target.value;
      searchDebounceTimer = setTimeout(() => {
        commitSearch(val);
      }, 140);
    });
  }

  document.getElementById('filter-telesale')?.addEventListener('change', (e) => {
    state.filters.telesale = e.target.value;
    state.pagination.page = 1;
    render();
  });

  document.getElementById('filter-status')?.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    state.pagination.page = 1;
    render();
  });

  document.getElementById('filter-month')?.addEventListener('change', (e) => {
    state.filters.monthKey = e.target.value;
    state.pagination.page = 1;
    render();
  });

  document.getElementById('btn-clear-filter')?.addEventListener('click', () => {
    state.filters = { search: '', telesale: 'all', status: 'all', monthKey: 'current' };
    state.pagination.page = 1;
    render();
  });

  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (state.pagination.page > 1) {
      state.pagination.page--;
      render();
    }
  });

  document.getElementById('btn-next')?.addEventListener('click', () => {
    const totalPages = Math.max(
      1,
      Math.ceil(getFilteredRecords().length / state.pagination.pageSize)
    );
    if (state.pagination.page < totalPages) {
      state.pagination.page++;
      render();
    }
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = btn.getAttribute('data-copy');
      if (!p) return;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(p);
        } else {
          fallbackCopyText(p);
        }
        notify(`Đã copy: ${p}`);
      } catch {
        fallbackCopyText(p);
        notify(`Đã copy: ${p}`);
      }
    });
  });

  const inferDefaultRevenueByService = (serviceText = '') => {
    const lower = String(serviceText || '').toLocaleLowerCase('vi-VN');
    if (lower.includes('999')) return '999.000';
    if (lower.includes('1tr999') || lower.includes('1.999') || lower.includes('1999')) {
      return '1.999.000';
    }
    if (lower.includes('2tr999') || lower.includes('2.999') || lower.includes('2999')) {
      return '2.999.000';
    }
    return '';
  };

  document.querySelectorAll('[data-status-select]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const id = sel.getAttribute('data-status-select');
      const nextStatus = e.target.value;
      const rec = findRecord(id);

      if (isArrivedStatusValue(nextStatus)) {
        if (state.currentUser?.role !== 'admin') {
          notify('Chỉ tài khoản Admin mới có quyền chuyển trạng thái khách sang ĐÃ ĐẾN');
          render();
          return;
        }
        state.arrivedModal = {
          recordId: id,
          status: nextStatus,
          defaultRevenue: inferDefaultRevenueByService(rec?.service),
        };
        render();
        const revInput = document.getElementById('arrived-revenue-input');
        if (revInput) {
          revInput.focus();
          revInput.select();
        }
        return;
      }

      const upperNext = String(nextStatus || '').trim().toUpperCase();
      const saveMsg =
        upperNext === 'ĐẶT HẸN' || upperNext === 'DỜI LỊCH'
          ? 'Đã chuyển Đặt hẹn & đồng bộ sang Sheet 2) KHÁCH ĐẶT HẸN'
          : 'Đã lưu tình trạng';
      quickSave(id, { status: nextStatus }, saveMsg);
    });
  });

  document.querySelectorAll('[data-date-picker]').forEach((picker) => {
    picker.addEventListener('click', () => {
      if (typeof picker.showPicker === 'function') {
        try {
          picker.showPicker();
        } catch {
          // ignore
        }
      }
    });

    picker.addEventListener('change', (e) => {
      const id = picker.getAttribute('data-date-picker');
      const vnDate = isoToVnDate(e.target.value);
      const saveMsg = vnDate
        ? 'Đã lưu ngày hẹn & đồng bộ sang Sheet 2) KHÁCH ĐẶT HẸN'
        : 'Đã cập nhật ngày hẹn';
      quickSave(id, { apptDate: vnDate }, saveMsg);
    });
  });

  document.querySelectorAll('[data-time-input]').forEach((input) => {
    const id = input.getAttribute('data-time-input');
    const rec = findRecord(id);
    const origTime = rec ? rec.apptTime || '' : '';

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      const nextTime = input.value.trim();
      if (nextTime !== origTime) {
        quickSave(id, { apptTime: nextTime }, 'Đã lưu giờ hẹn');
      }
    });
  });

  document.querySelectorAll('[data-telesale-select]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const id = sel.getAttribute('data-telesale-select');
      quickSave(id, { telesale: e.target.value }, 'Đã lưu Telesale');
    });
  });

  document.querySelectorAll('[data-note-input]').forEach((input) => {
    if (input.hasAttribute('readonly')) {
      return;
    }

    const id = input.getAttribute('data-note-input');
    const rec = findRecord(id);
    const originalNote = rec ? rec.noteM || '' : '';

    const fitHeight = () => {
      input.style.height = 'auto';
      if (input.scrollHeight > 0) {
        input.style.height = `${input.scrollHeight}px`;
      }
    };

    input.addEventListener('focus', fitHeight, { once: true });
    input.addEventListener('input', fitHeight);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('blur', (e) => {
      const related = e.relatedTarget;
      if (
        related &&
        (related.hasAttribute('data-admin-delete-notem') ||
          related.hasAttribute('data-admin-save-notem') ||
          related.hasAttribute('data-care-delete') ||
          related.hasAttribute('data-care-save'))
      ) {
        return;
      }
      const nextVal = input.value.trim();
      if (nextVal !== originalNote) {
        const finalNote =
          !originalNote.trim() && nextVal ? ensureNoteTimestampPrefix(nextVal) : nextVal;
        quickSave(id, { noteM: finalNote }, 'Đã lưu ghi chú');
      }
    });
  });

  // =========================================================================
  // SỰ KIỆN ADMIN SỬA / XÓA GHI CHÚ TRỰC TIẾP (Lần 1 & Lịch sử Care Lần 2+)
  // =========================================================================
  document.querySelectorAll('[data-admin-save-notem]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-admin-save-notem');
      const wrap = btn.closest('.note-tracker-wrap');
      const textarea =
        wrap?.querySelector(`[data-note-input="${id}"]`) ||
        document.querySelector(`[data-note-input="${id}"]`);
      if (!textarea) return;
      const rec = findRecord(id);
      const originalNote = rec ? rec.noteM || '' : '';
      const nextVal = textarea.value.trim();
      const finalNote =
        !originalNote.trim() && nextVal ? ensureNoteTimestampPrefix(nextVal) : nextVal;
      await quickSave(id, { noteM: finalNote }, 'Admin đã lưu ghi chú Lần 1');
    });
  });

  document.querySelectorAll('[data-admin-delete-notem]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-admin-delete-notem');
      const rec = findRecord(id);
      if (!rec) return;
      const origCare = Array.isArray(rec.careHistory) ? rec.careHistory : [];
      if (origCare.length > 0) {
        const firstCareText = String(origCare[0]?.text ?? origCare[0] ?? '').trim();
        const remainingCare = origCare.slice(1);
        await quickSave(
          id,
          { noteM: firstCareText, careHistory: remainingCare },
          'Admin đã xóa ghi chú Lần 1 bị lỗi'
        );
      } else {
        await quickSave(id, { noteM: '' }, 'Admin đã xóa ghi chú Lần 1');
      }
    });
  });

  const saveAdminCareItem = async (id, careIdx, rawNewText) => {
    const rec = findRecord(id);
    if (!rec) return;
    const origCare = Array.isArray(rec.careHistory) ? rec.careHistory : [];
    const cleanText = String(rawNewText || '').trim();
    const nextCare = origCare
      .map((item, idx) => {
        const existingText = String(item?.text ?? item ?? '').trim();
        const existingAddedAt = item?.addedAt || '';
        if (idx === careIdx) {
          return cleanText ? { text: cleanText, addedAt: existingAddedAt } : null;
        }
        return existingText ? { text: existingText, addedAt: existingAddedAt } : null;
      })
      .filter(Boolean);

    await quickSave(
      id,
      { careHistory: nextCare },
      cleanText ? 'Admin đã cập nhật ghi chú liên hệ' : 'Admin đã xóa ghi chú liên hệ'
    );
  };

  document.querySelectorAll('[data-care-edit-input]').forEach((input) => {
    const id = input.getAttribute('data-care-edit-input');
    const careIdx = Number(input.getAttribute('data-care-index'));
    const rec = findRecord(id);
    const origCare = Array.isArray(rec?.careHistory) ? rec.careHistory : [];
    const origText = String(origCare[careIdx]?.text ?? origCare[careIdx] ?? '').trim();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('blur', (e) => {
      const related = e.relatedTarget;
      if (
        related &&
        (related.hasAttribute('data-care-delete') ||
          related.hasAttribute('data-care-save') ||
          related.hasAttribute('data-admin-delete-notem') ||
          related.hasAttribute('data-admin-save-notem'))
      ) {
        return;
      }
      const nextText = input.value.trim();
      if (nextText !== origText) {
        saveAdminCareItem(id, careIdx, nextText);
      }
    });
  });

  document.querySelectorAll('[data-care-save]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-care-save');
      const careIdx = Number(btn.getAttribute('data-care-index'));
      const itemWrap = btn.closest('.care-timeline-item');
      const input =
        itemWrap?.querySelector('[data-care-edit-input]') ||
        document.querySelector(
          `[data-care-edit-input="${id}"][data-care-index="${careIdx}"]`
        );
      if (!input) return;
      await saveAdminCareItem(id, careIdx, input.value);
    });
  });

  document.querySelectorAll('[data-care-delete]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-care-delete');
      const careIdx = Number(btn.getAttribute('data-care-index'));
      await saveAdminCareItem(id, careIdx, '');
    });
  });

  document.querySelectorAll('[data-toggle-care]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-care');
      state.activeCareInputId = state.activeCareInputId === id ? null : id;
      render();
      if (state.activeCareInputId) {
        const careInput = document.getElementById(`care-input-${id}`);
        if (careInput) careInput.focus();
      }
    });
  });

  const submitCareNoteForRecord = async (recordId, rawCareText) => {
    const rec = findRecord(recordId);
    const cleanText = String(rawCareText || '').trim();
    if (!rec || !cleanText) return;
    const stamped = ensureNoteTimestampPrefix(cleanText);
    state.activeCareInputId = null;

    if (!String(rec.noteM || '').trim()) {
      await quickSave(recordId, { noteM: stamped }, 'Đã lưu Lần liên hệ 1');
    } else {
      const log = analyzeContactLogs(rec);
      await quickSave(
        recordId,
        {},
        `Đã lưu Lần liên hệ ${log.totalContacts + 1}`,
        stamped
      );
    }
  };

  document.querySelectorAll('[data-care-chip]').forEach((chipBtn) => {
    chipBtn.addEventListener('click', () => {
      const id = chipBtn.getAttribute('data-care-chip');
      const chipText = chipBtn.getAttribute('data-chip-text') || '';
      const inputEl = document.getElementById(`care-input-${id}`);
      if (inputEl) {
        inputEl.value = chipText;
        inputEl.focus();
      }
    });
  });

  document.querySelectorAll('[data-care-input]').forEach((inputEl) => {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = inputEl.getAttribute('data-care-input');
        submitCareNoteForRecord(id, inputEl.value);
      }
    });
  });

  document.querySelectorAll('[data-save-care]').forEach((saveBtn) => {
    saveBtn.addEventListener('click', () => {
      const id = saveBtn.getAttribute('data-save-care');
      const inputEl = document.getElementById(`care-input-${id}`);
      if (inputEl && inputEl.value.trim()) {
        submitCareNoteForRecord(id, inputEl.value);
      } else {
        notify('Vui lòng nhập nội dung lần liên hệ');
      }
    });
  });

  document.querySelectorAll('[data-edit-record]').forEach((el) => {
    el.addEventListener('click', () => {
      state.editingRecordId = el.getAttribute('data-edit-record');
      render();
    });
  });

  const closeModal = () => {
    state.editingRecordId = null;
    render();
  };

  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      closeModal();
    }
  });
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal')?.addEventListener('click', closeModal);

  document.getElementById('modal-status')?.addEventListener('change', (e) => {
    if (state.currentUser?.role !== 'admin') return;
    const revWrap = document.getElementById('modal-revenue-wrap');
    const revInput = document.getElementById('modal-revenue');
    if (!revWrap) return;
    if (isArrivedStatusValue(e.target.value)) {
      revWrap.classList.remove('is-hidden');
      const rec = findRecord(state.editingRecordId);
      if (revInput && !revInput.value.trim()) {
        revInput.value = inferDefaultRevenueByService(rec?.service);
      }
      revInput?.focus();
    } else {
      revWrap.classList.add('is-hidden');
    }
  });

  document.querySelectorAll('[data-modal-rev-chip]').forEach((chipBtn) => {
    chipBtn.addEventListener('click', () => {
      const val = chipBtn.getAttribute('data-modal-rev-chip') || '';
      const revInput = document.getElementById('modal-revenue');
      if (revInput) {
        revInput.value = val;
        revInput.focus();
      }
    });
  });

  document.getElementById('btn-modal-clear-notem')?.addEventListener('click', () => {
    const noteEl = document.getElementById('modal-notem');
    if (noteEl) {
      noteEl.value = '';
      noteEl.focus();
    }
  });

  document.querySelectorAll('[data-modal-care-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rowEl = btn.closest('[data-modal-care-row]');
      if (rowEl) {
        rowEl.remove();
      }
    });
  });

  document.querySelectorAll('[data-modal-care-chip]').forEach((chipBtn) => {
    chipBtn.addEventListener('click', () => {
      const chipText = chipBtn.getAttribute('data-modal-care-chip') || '';
      const inputEl = document.getElementById('modal-new-care');
      if (inputEl) {
        inputEl.value = chipText;
        inputEl.focus();
      }
    });
  });

  document.getElementById('btn-save-modal')?.addEventListener('click', async () => {
    const id = state.editingRecordId;
    if (!id) return;
    const rec = findRecord(id);
    const status = document.getElementById('modal-status')?.value ?? '';
    const telesale = document.getElementById('modal-telesale')?.value || '';
    const customerInfo = document.getElementById('modal-custinfo')?.value || '';
    const apptTime = document.getElementById('modal-appttime')?.value || '';
    const rawIsoDate = document.getElementById('modal-apptdate')?.value || '';
    const apptDate = isoToVnDate(rawIsoDate);
    let noteM = document.getElementById('modal-notem')?.value?.trim() || '';
    const newCareRaw = document.getElementById('modal-new-care')?.value?.trim() || '';

    if (!String(rec?.noteM || '').trim() && noteM) {
      noteM = ensureNoteTimestampPrefix(noteM);
    }

    const updatesPayload = { status, telesale, customerInfo, apptTime, apptDate, noteM };

    if (state.currentUser?.role === 'admin') {
      const modalRevenueVal = document.getElementById('modal-revenue')?.value?.trim() || '';
      if (modalRevenueVal !== '' || isArrivedStatusValue(status)) {
        if (modalRevenueVal !== '') {
          updatesPayload.revenue = modalRevenueVal;
        }
      }

      const modalCareListEl = document.getElementById('modal-care-list');
      if (modalCareListEl) {
        const origCare = Array.isArray(rec?.careHistory) ? rec.careHistory : [];
        const careInputs = Array.from(
          modalCareListEl.querySelectorAll('[data-modal-care-input]')
        );
        updatesPayload.careHistory = careInputs
          .map((inputEl) => {
            const cIdx = Number(inputEl.getAttribute('data-modal-care-input'));
            const txt = inputEl.value.trim();
            if (!txt) return null;
            return {
              text: txt,
              addedAt: origCare[cIdx]?.addedAt || '',
            };
          })
          .filter(Boolean);
      }
    }

    let appendCare = '';
    if (newCareRaw) {
      const stampedCare = ensureNoteTimestampPrefix(newCareRaw);
      if (!updatesPayload.noteM) {
        updatesPayload.noteM = stampedCare;
      } else {
        appendCare = stampedCare;
      }
    }

    const saveBtn = document.getElementById('btn-save-modal');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Đang lưu...';
    }

    state.editingRecordId = null;
    await quickSave(
      id,
      updatesPayload,
      isArrivedStatusValue(status)
        ? 'Đã chuyển sang Sheet 3) KHÁCH ĐÃ ĐẾN & lưu doanh số Cột W'
        : appendCare
        ? 'Đã lưu thông tin & thêm lần liên hệ mới'
        : 'Đã lưu thông tin khách hàng',
      appendCare
    );
    if (state.currentUser?.role === 'admin' && isArrivedStatusValue(status)) {
      resolveAdminOverviewSafe()
        .then((ov) => {
          if (ov) state.adminOverview = ov;
        })
        .catch(() => {});
    }
  });

  // =========================================================================
  // SỰ KIỆN MODAL XÁC NHẬN ĐÃ ĐẾN & NHẬP DOANH SỐ CỘT W (CHỈ ADMIN)
  // =========================================================================
  const closeArrivedModal = () => {
    state.arrivedModal = null;
    render();
  };

  document.getElementById('arrived-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'arrived-modal-overlay') {
      closeArrivedModal();
    }
  });
  document.getElementById('btn-close-arrived-modal')?.addEventListener('click', closeArrivedModal);
  document.getElementById('btn-cancel-arrived-modal')?.addEventListener('click', closeArrivedModal);

  document.querySelectorAll('[data-arrived-rev-chip]').forEach((chipBtn) => {
    chipBtn.addEventListener('click', () => {
      const val = chipBtn.getAttribute('data-arrived-rev-chip') || '';
      const revInput = document.getElementById('arrived-revenue-input');
      if (revInput) {
        revInput.value = val;
        revInput.focus();
      }
    });
  });

  document.getElementById('arrived-revenue-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.arrivedModal || state.currentUser?.role !== 'admin') return;
    const { recordId, status } = state.arrivedModal;
    const revenueVal = document.getElementById('arrived-revenue-input')?.value?.trim() || '0';
    const confirmBtn = document.getElementById('btn-confirm-arrived-revenue');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Đang lưu...';
    }
    state.arrivedModal = null;
    await quickSave(
      recordId,
      { status: status || 'ĐÃ ĐẾN', revenue: revenueVal },
      'Đã chuyển sang Sheet 3) KHÁCH ĐÃ ĐẾN & ghi doanh số vào Cột W!'
    );
    resolveAdminOverviewSafe()
      .then((ov) => {
        if (ov) state.adminOverview = ov;
      })
      .catch(() => {});
  });

  // =========================================================================
  // SỰ KIỆN MODAL THÊM DATA KHÁCH HÀNG TỪ MESSENGER (CHỈ ADMIN)
  // =========================================================================
  document.querySelectorAll('[data-open-add-lead]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.currentUser?.role !== 'admin') return;
      state.addLeadModalOpen = true;
      render();
      document.getElementById('add-lead-name')?.focus();
    });
  });

  const closeAddLeadModal = () => {
    state.addLeadModalOpen = false;
    render();
  };

  document.getElementById('add-lead-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'add-lead-modal-overlay') {
      closeAddLeadModal();
    }
  });
  document.getElementById('btn-close-add-lead')?.addEventListener('click', closeAddLeadModal);
  document.getElementById('btn-cancel-add-lead')?.addEventListener('click', closeAddLeadModal);

  document.getElementById('add-lead-service-select')?.addEventListener('change', (e) => {
    const customInput = document.getElementById('add-lead-service-custom');
    if (!customInput) return;
    if (e.target.value === '__OTHER__') {
      customInput.classList.remove('is-hidden');
      customInput.required = true;
      customInput.focus();
    } else {
      customInput.classList.add('is-hidden');
      customInput.required = false;
    }
  });

  document.getElementById('add-lead-source-select')?.addEventListener('change', (e) => {
    const customInput = document.getElementById('add-lead-source-custom');
    if (!customInput) return;
    if (e.target.value === '__OTHER__') {
      customInput.classList.remove('is-hidden');
      customInput.required = true;
      customInput.focus();
    } else {
      customInput.classList.add('is-hidden');
      customInput.required = false;
    }
  });

  document.getElementById('add-lead-status')?.addEventListener('change', (e) => {
    const revWrap = document.getElementById('add-lead-revenue-wrap');
    const revInput = document.getElementById('add-lead-revenue');
    if (!revWrap) return;
    if (isArrivedStatusValue(e.target.value)) {
      revWrap.classList.remove('is-hidden');
      const svcSel = document.getElementById('add-lead-service-select')?.value || '';
      if (revInput && !revInput.value.trim()) {
        revInput.value = inferDefaultRevenueByService(svcSel);
      }
      revInput?.focus();
    } else {
      revWrap.classList.add('is-hidden');
    }
  });

  document.querySelectorAll('[data-add-lead-rev-chip]').forEach((chipBtn) => {
    chipBtn.addEventListener('click', () => {
      const val = chipBtn.getAttribute('data-add-lead-rev-chip') || '';
      const revInput = document.getElementById('add-lead-revenue');
      if (revInput) {
        revInput.value = val;
        revInput.focus();
      }
    });
  });

  document.getElementById('add-lead-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.currentUser?.role !== 'admin') return;

    const rawDataDateIso = document.getElementById('add-lead-datadate')?.value || '';
    const dataDate = isoToVnDate(rawDataDateIso);
    const name = document.getElementById('add-lead-name')?.value?.trim() || '';
    const phone = document.getElementById('add-lead-phone')?.value?.trim() || '';

    const svcSelectVal = document.getElementById('add-lead-service-select')?.value || '';
    const svcCustomVal = document.getElementById('add-lead-service-custom')?.value?.trim() || '';
    const service = svcSelectVal === '__OTHER__' ? svcCustomVal : svcSelectVal;

    if (svcSelectVal === '__OTHER__' && !service) {
      notify('Vui lòng nhập tên dịch vụ khác');
      document.getElementById('add-lead-service-custom')?.focus();
      return;
    }

    const srcSelectVal = document.getElementById('add-lead-source-select')?.value || '';
    const srcCustomVal = document.getElementById('add-lead-source-custom')?.value?.trim() || '';
    const source = srcSelectVal === '__OTHER__' ? srcCustomVal : srcSelectVal;

    if (srcSelectVal === '__OTHER__' && !source) {
      notify('Vui lòng nhập nguồn khách khác');
      document.getElementById('add-lead-source-custom')?.focus();
      return;
    }

    const fbLink = document.getElementById('add-lead-fblink')?.value?.trim() || '';
    const customerInfo = document.getElementById('add-lead-custinfo')?.value?.trim() || '';
    const status = document.getElementById('add-lead-status')?.value || '';
    const rawApptDateIso = document.getElementById('add-lead-apptdate')?.value || '';
    const apptDate = isoToVnDate(rawApptDateIso);
    const apptTime = document.getElementById('add-lead-appttime')?.value?.trim() || '';
    const telesale = document.getElementById('add-lead-telesale')?.value || '';
    const noteM = document.getElementById('add-lead-notem')?.value?.trim() || '';
    const revenue = document.getElementById('add-lead-revenue')?.value?.trim() || '';

    const submitBtn = document.getElementById('btn-submit-add-lead');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Đang lưu...';
    }

    try {
      const res = await createAdminLead({
        dataDate,
        name,
        phone,
        service,
        source,
        fbLink,
        customerInfo,
        status,
        apptDate,
        apptTime,
        telesale,
        noteM: noteM ? ensureNoteTimestampPrefix(noteM) : '',
        revenue: isArrivedStatusValue(status) ? revenue : undefined,
      });

      state.crmData = res.crmData;
      state.addLeadModalOpen = false;
      state.pagination.page = 1;

      if (res.syncedArrived) {
        notify(`Đã thêm khách "${name}" & ghi nhận Doanh số!`);
      } else if (res.syncedBooked) {
        notify(`Đã thêm khách "${name}" & đồng bộ sang Khách Đặt Hẹn!`);
      } else {
        notify(`Đã thêm khách hàng "${name}" thành công!`);
      }
      render();

      resolveAdminOverviewSafe()
        .then((ov) => {
          if (ov) state.adminOverview = ov;
        })
        .catch(() => {});
    } catch (err) {
      notify(`Lỗi thêm khách hàng: ${err.message}`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Lưu Khách Hàng';
      }
    }
  });
}

async function init() {
  try {
    state.authChecking = true;
    render();

    const user = await fetchCurrentUser();
    state.currentUser = user;
    state.authChecking = false;

    if (!user) {
      render();
    } else {
      await loadAuthenticatedWorkspace();
    }

    setInterval(async () => {
      if (!state.currentUser || state.activeTab === 'admin') return;
      const active = document.activeElement;
      const isEditing =
        active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
      if (
        isEditing ||
        state.editingRecordId ||
        state.addLeadModalOpen ||
        state.arrivedModal ||
        state.refreshing
      ) {
        return;
      }
      try {
        state.crmData = await fetchCrmData(false);
        render();
      } catch (err) {
        if (err.requireAuth) {
          state.currentUser = null;
          render();
        }
      }
    }, 45000);
  } catch (err) {
    state.authChecking = false;
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div class="app-loading">
          <p style="color:#be123c">Chưa kết nối được máy chủ (${escapeHtml(err.message)})</p>
          <button class="btn-clean btn-primary-clean" onclick="location.reload()">Thử lại</button>
        </div>
      `;
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.arrivedModal) {
        state.arrivedModal = null;
        render();
      } else if (state.addLeadModalOpen) {
        state.addLeadModalOpen = false;
        render();
      } else if (state.editingRecordId) {
        state.editingRecordId = null;
        render();
      }
    }
  });
  let lastMobileState = isMobileViewport();
  window.addEventListener('resize', () => {
    const nowMobile = isMobileViewport();
    if (nowMobile !== lastMobileState) {
      lastMobileState = nowMobile;
      render();
    }
  });
  init();
}
