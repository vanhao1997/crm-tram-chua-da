import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT_DIR, DEFAULT_TELESALE_LIST } from './config.js';

const DATA_DIR = path.join(ROOT_DIR, 'server', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const AUTH_SECRET =
  process.env.CRM_AUTH_SECRET || 'crm-bsn-secret-key-2026-tram-chua-da';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const DISK_ENC_KEY = crypto.createHash('sha256').update(`disk:${AUTH_SECRET}`).digest();

// Chống Brute-Force dò mật khẩu: tối đa 8 lần sai / 5 phút trên mỗi IP
const LOGIN_RATE_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttemptsByIp = new Map();

function encryptForDisk(plainText) {
  const str = String(plainText ?? '');
  if (!str || str.startsWith('enc:v1:')) return str;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', DISK_ENC_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch {
    return str;
  }
}

function decryptFromDisk(storedVal) {
  const str = String(storedVal ?? '');
  if (!str.startsWith('enc:v1:')) return str;
  try {
    const parts = str.split(':');
    if (parts.length !== 5) return '••••••';
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const encrypted = Buffer.from(parts[4], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', DISK_ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '••••••';
  }
}

export function checkLoginRateLimit(clientIp = 'unknown') {
  if (process.env.NODE_TEST_CONTEXT) return;
  const now = Date.now();
  const entry = loginAttemptsByIp.get(clientIp);
  if (!entry) return;
  if (now - entry.firstAttemptAt > LOGIN_RATE_WINDOW_MS) {
    loginAttemptsByIp.delete(clientIp);
    return;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    const waitSec = Math.max(
      1,
      Math.ceil((LOGIN_RATE_WINDOW_MS - (now - entry.firstAttemptAt)) / 1000)
    );
    const err = new Error(
      `Tạm khóa đăng nhập do nhập sai quá nhiều lần. Vui lòng thử lại sau ${waitSec} giây.`
    );
    err.statusCode = 429;
    throw err;
  }
}

function recordLoginFailure(clientIp = 'unknown') {
  if (process.env.NODE_TEST_CONTEXT) return;
  const now = Date.now();
  const entry = loginAttemptsByIp.get(clientIp);
  if (!entry || now - entry.firstAttemptAt > LOGIN_RATE_WINDOW_MS) {
    loginAttemptsByIp.set(clientIp, { count: 1, firstAttemptAt: now });
  } else {
    entry.count++;
  }
}

function clearLoginFailures(clientIp = 'unknown') {
  if (clientIp) loginAttemptsByIp.delete(clientIp);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function nfc(val) {
  return String(val ?? '').normalize('NFC').trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derivedBuf = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derivedBuf.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, keyBuf);
}

function slugifyUsername(name, index) {
  const clean = nfc(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!clean || clean.startsWith('telesale')) {
    return `sale${index + 1}`;
  }
  return clean;
}

function buildDefaultUsers() {
  const now = new Date().toISOString();
  const adminUser = nfc(process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const adminPass = nfc(process.env.ADMIN_PASSWORD || 'bsn@2026');

  const users = [
    {
      id: 'usr-admin',
      username: adminUser,
      passwordHash: hashPassword(adminPass),
      passwordDisplay: adminPass,
      telesaleName: 'ADMIN',
      fullName: nfc('Quản trị viên CRM'),
      role: 'admin',
      active: true,
      permissions: {
        accessCrm: true,
        canEdit: true,
        canSendTelegram: true,
        dataScope: 'all', // 'all' | 'own_and_unassigned' | 'own_only'
      },
      createdAt: now,
      updatedAt: now,
    },
  ];

  const usedUsernames = new Set([adminUser]);

  DEFAULT_TELESALE_LIST.forEach((rawName, idx) => {
    const telesaleName = nfc(rawName).toUpperCase();
    let username = slugifyUsername(telesaleName, idx);
    if (usedUsernames.has(username)) {
      username = `${username}${idx + 1}`;
    }
    usedUsernames.add(username);
    const defaultPass = '123456';

    users.push({
      id: `usr-sale-${idx + 1}`,
      username,
      passwordHash: hashPassword(defaultPass),
      passwordDisplay: defaultPass,
      telesaleName,
      fullName: nfc(`Telesale ${telesaleName}`),
      role: 'telesale',
      active: true,
      permissions: {
        accessCrm: true,
        canEdit: true,
        canSendTelegram: true,
        dataScope: 'all',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  return users;
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    const defaults = buildDefaultUsers();
    saveUsers(defaults);
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (Array.isArray(parsed) && parsed.length > 0) {
      let needsResave = false;
      const hydrated = parsed.map((u) => {
        const rawDisp = String(u.passwordDisplay || '');
        if (rawDisp && !rawDisp.startsWith('enc:v1:')) {
          needsResave = true;
        }
        return {
          ...u,
          passwordDisplay: decryptFromDisk(rawDisp),
        };
      });
      if (needsResave) {
        saveUsers(hydrated);
      }
      return hydrated;
    }
  } catch {
    // Fallback to defaults if corrupted
  }
  const defaults = buildDefaultUsers();
  saveUsers(defaults);
  return defaults;
}

function saveUsers(users) {
  ensureDataDir();
  const diskRecords = users.map((u) => ({
    ...u,
    passwordDisplay: encryptForDisk(u.passwordDisplay || ''),
  }));
  fs.writeFileSync(USERS_FILE, JSON.stringify(diskRecords, null, 2), 'utf8');
}

let usersStore = loadUsers();

export function reloadUsersStore() {
  usersStore = loadUsers();
  return usersStore;
}

export function sanitizeUserForClient(user, includePasswordForAdmin = false) {
  if (!user) return null;
  const safe = {
    id: user.id,
    username: nfc(user.username),
    telesaleName: nfc(user.telesaleName).toUpperCase(),
    fullName: nfc(user.fullName || user.telesaleName),
    role: user.role === 'admin' ? 'admin' : 'telesale',
    active: Boolean(user.active),
    permissions: {
      accessCrm: user.permissions?.accessCrm !== false,
      canEdit: user.permissions?.canEdit !== false,
      canSendTelegram: user.permissions?.canSendTelegram !== false,
      dataScope: user.permissions?.dataScope || 'all',
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
  };

  if (includePasswordForAdmin) {
    safe.passwordDisplay = decryptFromDisk(user.passwordDisplay || '') || '••••••';
  }
  return safe;
}

export function createAuthToken(user) {
  const payloadObj = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    const liveUser = usersStore.find((u) => u.id === payload.sub);
    if (!liveUser) return null;
    if (!liveUser.active || liveUser.permissions?.accessCrm === false) {
      return null;
    }
    return sanitizeUserForClient(liveUser, false);
  } catch {
    return null;
  }
}

export function extractRequestUser(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return verifyAuthToken(token);
  }

  const cookieHeader = req.headers?.cookie || '';
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)crm_bsn_token=([^;]+)/);
    if (match && match[1]) {
      return verifyAuthToken(decodeURIComponent(match[1]));
    }
  }
  return null;
}

export function authenticateUser(username, password, clientIp = '') {
  if (clientIp) {
    checkLoginRateLimit(clientIp);
  }
  const cleanUsername = nfc(username).toLowerCase();
  const rawPassword = String(password ?? '');

  if (!cleanUsername || !rawPassword) {
    throw new Error('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu');
  }

  const user = usersStore.find((u) => nfc(u.username).toLowerCase() === cleanUsername);
  if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
    if (clientIp) recordLoginFailure(clientIp);
    throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác');
  }

  if (!user.active || user.permissions?.accessCrm === false) {
    throw new Error('Tài khoản của bạn đã bị khóa hoặc chưa được cấp quyền vào CRM');
  }

  if (clientIp) {
    clearLoginFailures(clientIp);
  }

  user.lastLoginAt = new Date().toISOString();
  saveUsers(usersStore);

  const token = createAuthToken(user);
  return {
    ok: true,
    token,
    user: sanitizeUserForClient(user, false),
  };
}

export function listUsersForAdmin() {
  return usersStore.map((u) => sanitizeUserForClient(u, true));
}

export function getActiveTelesaleNames() {
  const names = [];
  const seen = new Set();

  for (const u of usersStore) {
    if (!u.active || u.permissions?.accessCrm === false) continue;
    const tName = nfc(u.telesaleName).toUpperCase();
    if (!tName || tName === 'ADMIN' || tName === 'QUẢN TRỊ VIÊN') continue;
    if (!seen.has(tName)) {
      seen.add(tName);
      names.push(tName);
    }
  }

  if (names.length === 0) {
    return [...DEFAULT_TELESALE_LIST];
  }
  return names;
}

export function createUser(payload = {}) {
  const username = nfc(payload.username)
    .toLowerCase()
    .replace(/\s+/g, '');
  const password = nfc(payload.password);
  const role = payload.role === 'admin' ? 'admin' : 'telesale';
  const telesaleName = nfc(
    payload.telesaleName || (role === 'admin' ? 'ADMIN' : username)
  ).toUpperCase();
  const fullName = nfc(payload.fullName || telesaleName);

  if (!username || username.length < 2) {
    throw new Error('Tên đăng nhập (User) phải có ít nhất 2 ký tự');
  }
  if (!password || password.length < 4) {
    throw new Error('Mật khẩu (Pass) phải có ít nhất 4 ký tự');
  }
  if (role === 'telesale' && !telesaleName) {
    throw new Error('Vui lòng đặt tên Telesale (hiển thị ở Cột L)');
  }

  const duplicate = usersStore.find((u) => nfc(u.username).toLowerCase() === username);
  if (duplicate) {
    throw new Error(`Tên đăng nhập "${username}" đã tồn tại`);
  }

  const now = new Date().toISOString();
  const active = payload.active !== undefined ? Boolean(payload.active) : true;
  const accessCrm =
    payload.permissions?.accessCrm !== undefined
      ? Boolean(payload.permissions.accessCrm)
      : active;

  const newUser = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username,
    passwordHash: hashPassword(password),
    passwordDisplay: password,
    telesaleName,
    fullName,
    role,
    active: active && accessCrm,
    permissions: {
      accessCrm: active && accessCrm,
      canEdit:
        payload.permissions?.canEdit !== undefined
          ? Boolean(payload.permissions.canEdit)
          : true,
      canSendTelegram:
        payload.permissions?.canSendTelegram !== undefined
          ? Boolean(payload.permissions.canSendTelegram)
          : true,
      dataScope: ['all', 'own_and_unassigned', 'own_only'].includes(
        payload.permissions?.dataScope
      )
        ? payload.permissions.dataScope
        : 'all',
    },
    createdAt: now,
    updatedAt: now,
  };

  usersStore.push(newUser);
  saveUsers(usersStore);
  return sanitizeUserForClient(newUser, true);
}

export function updateUser(userId, payload = {}) {
  const idx = usersStore.findIndex((u) => u.id === userId);
  if (idx === -1) {
    throw new Error('Không tìm thấy tài khoản cần cập nhật');
  }

  const existing = usersStore[idx];

  if (payload.username !== undefined) {
    const nextUsername = nfc(payload.username)
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!nextUsername || nextUsername.length < 2) {
      throw new Error('Tên đăng nhập phải có ít nhất 2 ký tự');
    }
    const dup = usersStore.find(
      (u) => u.id !== userId && nfc(u.username).toLowerCase() === nextUsername
    );
    if (dup) {
      throw new Error(`Tên đăng nhập "${nextUsername}" đã được sử dụng`);
    }
    existing.username = nextUsername;
  }

  if (payload.password !== undefined && String(payload.password).trim() !== '') {
    const nextPass = nfc(payload.password);
    if (nextPass.length < 4) {
      throw new Error('Mật khẩu mới phải có ít nhất 4 ký tự');
    }
    existing.passwordHash = hashPassword(nextPass);
    existing.passwordDisplay = nextPass;
  }

  if (payload.telesaleName !== undefined) {
    existing.telesaleName = nfc(payload.telesaleName).toUpperCase();
  }

  if (payload.fullName !== undefined) {
    existing.fullName = nfc(payload.fullName);
  }

  if (payload.role !== undefined) {
    const nextRole = payload.role === 'admin' ? 'admin' : 'telesale';
    if (existing.role === 'admin' && nextRole !== 'admin') {
      const activeAdmins = usersStore.filter(
        (u) => u.role === 'admin' && u.active && u.id !== userId
      );
      if (activeAdmins.length === 0) {
        throw new Error('Phải giữ lại ít nhất 1 tài khoản Admin đang hoạt động');
      }
    }
    existing.role = nextRole;
  }

  if (payload.active !== undefined) {
    const nextActive = Boolean(payload.active);
    if (existing.role === 'admin' && !nextActive) {
      const activeAdmins = usersStore.filter(
        (u) => u.role === 'admin' && u.active && u.id !== userId
      );
      if (activeAdmins.length === 0) {
        throw new Error('Không thể khóa tài khoản Admin duy nhất đang hoạt động');
      }
    }
    existing.active = nextActive;
    existing.permissions = {
      ...existing.permissions,
      accessCrm: nextActive,
    };
  }

  if (payload.permissions && typeof payload.permissions === 'object') {
    if (payload.permissions.accessCrm !== undefined) {
      const nextAccess = Boolean(payload.permissions.accessCrm);
      if (existing.role === 'admin' && !nextAccess) {
        const activeAdmins = usersStore.filter(
          (u) => u.role === 'admin' && u.active && u.id !== userId
        );
        if (activeAdmins.length === 0) {
          throw new Error('Không thể thu hồi quyền của tài khoản Admin duy nhất');
        }
      }
      existing.active = nextAccess;
      existing.permissions.accessCrm = nextAccess;
    }
    if (payload.permissions.canEdit !== undefined) {
      existing.permissions.canEdit = Boolean(payload.permissions.canEdit);
    }
    if (payload.permissions.canSendTelegram !== undefined) {
      existing.permissions.canSendTelegram = Boolean(payload.permissions.canSendTelegram);
    }
    if (
      payload.permissions.dataScope &&
      ['all', 'own_and_unassigned', 'own_only'].includes(payload.permissions.dataScope)
    ) {
      existing.permissions.dataScope = payload.permissions.dataScope;
    }
  }

  existing.updatedAt = new Date().toISOString();
  saveUsers(usersStore);
  return sanitizeUserForClient(existing, true);
}

export function deleteUser(userId, actingUserId) {
  if (userId === actingUserId) {
    throw new Error('Không thể tự xóa tài khoản Admin đang đăng nhập');
  }
  const target = usersStore.find((u) => u.id === userId);
  if (!target) {
    throw new Error('Không tìm thấy tài khoản cần xóa');
  }
  if (target.role === 'admin') {
    const otherAdmins = usersStore.filter(
      (u) => u.role === 'admin' && u.active && u.id !== userId
    );
    if (otherAdmins.length === 0) {
      throw new Error('Không thể xóa tài khoản Admin duy nhất của hệ thống');
    }
  }

  usersStore = usersStore.filter((u) => u.id !== userId);
  saveUsers(usersStore);
  return { ok: true, deletedId: userId };
}

export function filterCrmDataForUser(crmData, user) {
  if (!crmData || !user) return crmData;

  const activeTelesales = getActiveTelesaleNames();
  const baseResult = {
    ...crmData,
    telesaleList: activeTelesales,
    currentUser: sanitizeUserForClient(user, false),
  };

  if (user.role === 'admin') {
    return baseResult;
  }

  const scope = user.permissions?.dataScope || 'all';
  if (scope === 'all') {
    return baseResult;
  }

  const myName = nfc(user.telesaleName).toUpperCase();
  const filteredSheets = {};

  for (const [sheetKey, sheetObj] of Object.entries(crmData.sheets || {})) {
    const records = (sheetObj.records || []).filter((rec) => {
      const assigned = nfc(rec.telesale).toUpperCase();
      if (scope === 'own_only') {
        return assigned !== '' && assigned === myName;
      }
      // own_and_unassigned
      return assigned === '' || assigned === myName;
    });

    filteredSheets[sheetKey] = {
      ...sheetObj,
      records,
    };
  }

  return {
    ...baseResult,
    sheets: filteredSheets,
  };
}
