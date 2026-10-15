const TOKEN_STORAGE_KEY = 'crm_bsn_auth_token';

export function getStoredAuthToken() {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    }
  } catch {
    // Ignore storage access errors
  }
  return '';
}

export function setStoredAuthToken(token) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

function buildHeaders(includeJson = false) {
  const headers = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getStoredAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function loginUser(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác');
  }
  if (data.token) {
    setStoredAuthToken(data.token);
  }
  return data;
}

export async function logoutUser() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: buildHeaders(false),
    });
  } catch {
    // Ignore network error on logout
  }
  setStoredAuthToken('');
}

export async function fetchCurrentUser() {
  const res = await fetch('/api/auth/me', {
    headers: buildHeaders(false),
  });
  if (!res.ok) {
    setStoredAuthToken('');
    return null;
  }
  const data = await res.json();
  return data?.user || null;
}

export async function fetchCrmData(forceRefresh = false) {
  const query = forceRefresh ? '?refresh=1' : '';
  const res = await fetch(`/api/crm/data${query}`, {
    headers: buildHeaders(false),
  });
  if (res.status === 401) {
    setStoredAuthToken('');
    const err = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    err.requireAuth = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Không thể tải dữ liệu (HTTP ${res.status})`);
  }
  return res.json();
}

export async function saveCustomerInteraction(payload) {
  const res = await fetch('/api/crm/interaction', {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.status === 401) {
    setStoredAuthToken('');
    const err = new Error(data.error || 'Vui lòng đăng nhập lại');
    err.requireAuth = true;
    throw err;
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Lỗi khi lưu cập nhật');
  }
  return data;
}

export async function createAdminLead(payload) {
  const res = await fetch('/api/crm/leads', {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.status === 401) {
    setStoredAuthToken('');
    const err = new Error(data.error || 'Vui lòng đăng nhập lại');
    err.requireAuth = true;
    throw err;
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể thêm khách hàng mới');
  }
  return data;
}

export async function deleteCustomerLead(payload) {
  const res = await fetch('/api/crm/leads', {
    method: 'DELETE',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.status === 401) {
    setStoredAuthToken('');
    const err = new Error(data.error || 'Vui lòng đăng nhập lại');
    err.requireAuth = true;
    throw err;
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể xóa dữ liệu khách hàng');
  }
  return data;
}

export async function triggerTelegramReminder(payload = {}) {
  const bodyObj =
    typeof payload === 'string'
      ? { range: payload }
      : payload && typeof payload === 'object'
      ? payload
      : {};
  const res = await fetch('/api/crm/telegram-reminder', {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(bodyObj),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể gửi thông báo Telegram');
  }
  return data;
}

export async function fetchAdminUsers() {
  const res = await fetch('/api/admin/users', {
    headers: buildHeaders(false),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không có quyền truy cập danh sách tài khoản');
  }
  return data.users || [];
}

export async function createAdminUser(payload) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể tạo tài khoản mới');
  }
  return data;
}

export async function updateAdminUser(payload) {
  const res = await fetch('/api/admin/users', {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể cập nhật tài khoản');
  }
  return data;
}

export async function deleteAdminUser(userId) {
  const res = await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: buildHeaders(true),
    body: JSON.stringify({ id: userId }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể xóa tài khoản');
  }
  return data;
}

export async function fetchAdminOverview({ period = 'month', from = '', to = '' } = {}) {
  const params = new URLSearchParams({ period });
  if (period === 'custom') {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  const res = await fetch(`/api/admin/overview?${params.toString()}`, {
    headers: buildHeaders(false),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Không thể tải dữ liệu Tổng quan CEO');
  }
  return data;
}

export async function fetchTelegramSchedule() {
  const res = await fetch('/api/admin/telegram-schedule', {
    headers: buildHeaders(false),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể tải cài đặt tự động gửi Telegram');
  }
  return data.schedule || { enabled: true, sendTime: '08:00', lastSentDate: '', lastSentTime: '' };
}

export async function updateTelegramSchedule(payload = {}) {
  const res = await fetch('/api/admin/telegram-schedule', {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Không thể lưu cài đặt tự động gửi Telegram');
  }
  return data.schedule;
}
