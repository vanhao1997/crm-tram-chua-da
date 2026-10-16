import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import { ROOT_DIR, APP_VERSION } from './config.js';
import {
  getAllSheetsData,
  updateCustomerInteraction,
  addAdminLead,
  deleteAdminLead,
  sendTelegramReminder,
  getTelegramScheduleConfig,
  updateTelegramScheduleConfig,
} from './google-sheets.js';
import { classifyStatus } from './sheets-parser.js';
import {
  authenticateUser,
  extractRequestUser,
  listUsersForAdmin,
  createUser,
  updateUser,
  deleteUser,
  filterCrmDataForUser,
} from './auth.js';
import { getAdminOverviewData } from './admin-overview.js';
import { recordActivityLog, listActivityLogs } from './activity-log.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const ALLOWED_SRC_EXTS = new Set(['.js', '.mjs', '.css']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

// Bộ nhớ đệm RAM cho file tĩnh (JS/CSS/HTML/Images) giúp phản hồi < 1ms, không đọc ổ cứng/nén lại mỗi request
const staticAssetCache = new Map();

function acceptsGzip(req) {
  const enc = req?.headers?.['accept-encoding'];
  return typeof enc === 'string' && enc.includes('gzip');
}

function getClientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req?.socket?.remoteAddress || 'unknown';
}

function sendJson(res, statusCode, payload, extraHeaders = {}, req = null) {
  const rawBody = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  };

  if (acceptsGzip(req) && Buffer.byteLength(rawBody) > 1024) {
    const compressed = zlib.gzipSync(rawBody, { level: zlib.constants.Z_BEST_SPEED });
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(statusCode, headers);
    res.end(compressed);
    return;
  }

  res.writeHead(statusCode, headers);
  res.end(rawBody);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload quá lớn'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON không hợp lệ'));
      }
    });
    req.on('error', reject);
  });
}

function getCachedStaticAsset(filePath, ext) {
  const stat = fs.statSync(filePath);
  const cached = staticAssetCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const rawBuf = fs.readFileSync(filePath);
  const isCompressible = COMPRESSIBLE_EXTS.has(ext) && rawBuf.length > 512;
  const gzipBuf = isCompressible
    ? zlib.gzipSync(rawBuf, { level: zlib.constants.Z_BEST_SPEED })
    : null;
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;

  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    etag,
    rawBuf,
    gzipBuf,
  };
  staticAssetCache.set(filePath, entry);
  return entry;
}

function sendStaticFileBuffer(filePath, ext, cacheControl, req, res) {
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const entry = getCachedStaticAsset(filePath, ext);
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    ETag: entry.etag,
    ...SECURITY_HEADERS,
  };

  if (req?.headers?.['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (entry.gzipBuf && acceptsGzip(req)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    res.end(entry.gzipBuf);
    return;
  }

  res.writeHead(200, headers);
  res.end(entry.rawBuf);
}

function isBlockedStaticPath(reqPath) {
  const lower = String(reqPath || '').toLowerCase();
  if (
    lower.includes('..') ||
    lower.includes('\0') ||
    lower.startsWith('/.') ||
    lower.startsWith('/server') ||
    lower.startsWith('/data') ||
    lower.startsWith('/tests') ||
    lower.startsWith('/node_modules') ||
    lower.startsWith('/scripts') ||
    lower.includes('google-apps-script') ||
    lower.includes('package.json') ||
    lower.includes('package-lock.json') ||
    lower.includes('dockerfile') ||
    lower.includes('vite.config') ||
    lower.endsWith('.bat') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.cmd') ||
    lower.endsWith('.ps1') ||
    lower.endsWith('.md') ||
    lower.endsWith('.env') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key')
  ) {
    return true;
  }
  return false;
}

function serveStaticFile(reqPath, res, req = null, hasVersionParam = false) {
  if (isBlockedStaticPath(reqPath)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }

  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;

  // 1. Kiểm tra trong thư mục public/ trước (chứa brandmark.webp, logo.jpg, favicon.png...)
  const publicDir = path.join(ROOT_DIR, 'public');
  const publicCandidate = path.resolve(publicDir, `.${cleanPath}`);
  if (
    publicCandidate.startsWith(publicDir) &&
    fs.existsSync(publicCandidate) &&
    fs.statSync(publicCandidate).isFile()
  ) {
    const ext = path.extname(publicCandidate).toLowerCase();
    sendStaticFileBuffer(publicCandidate, ext, 'public, max-age=86400', req, res);
    return;
  }

  // 2. Nếu truy cập trực tiếp vào /src/, chỉ cho phép các file frontend (.js, .mjs, .css)
  if (cleanPath.startsWith('/src/')) {
    const srcDir = path.join(ROOT_DIR, 'src');
    const srcCandidate = path.resolve(ROOT_DIR, `.${cleanPath}`);
    const ext = path.extname(srcCandidate).toLowerCase();
    if (
      !srcCandidate.startsWith(srcDir) ||
      !ALLOWED_SRC_EXTS.has(ext) ||
      !fs.existsSync(srcCandidate) ||
      !fs.statSync(srcCandidate).isFile()
    ) {
      res.writeHead(403, SECURITY_HEADERS);
      res.end('Forbidden');
      return;
    }
    const cacheControl = hasVersionParam
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    sendStaticFileBuffer(srcCandidate, ext, cacheControl, req, res);
    return;
  }

  // 3. Nếu có bản build dist/, phục vụ từ dist/
  const distDir = path.join(ROOT_DIR, 'dist');
  const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
  if (hasDist) {
    const distCandidate = path.resolve(distDir, `.${cleanPath}`);
    if (
      distCandidate.startsWith(distDir) &&
      fs.existsSync(distCandidate) &&
      fs.statSync(distCandidate).isFile()
    ) {
      const ext = path.extname(distCandidate).toLowerCase();
      const cacheControl =
        ext === '.html'
          ? 'no-store, no-cache, must-revalidate'
          : 'public, max-age=31536000, immutable';
      sendStaticFileBuffer(distCandidate, ext, cacheControl, req, res);
      return;
    }
  }

  // 4. Chỉ cho phép /index.html ở thư mục gốc (hoặc SPA fallback về index.html)
  const indexPath = hasDist
    ? path.join(distDir, 'index.html')
    : path.join(ROOT_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    sendStaticFileBuffer(indexPath, '.html', 'no-store, no-cache, must-revalidate', req, res);
    return;
  }

  res.writeHead(404, SECURITY_HEADERS);
  res.end('Not Found');
}

export async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    if (pathname === '/api/version' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, version: APP_VERSION });
    }

    if (
      (pathname === '/api/health' ||
        pathname === '/api/health/live' ||
        pathname === '/api/health/ready') &&
      req.method === 'GET'
    ) {
      return sendJson(res, 200, {
        ok: true,
        status: pathname.endsWith('/ready') ? 'ready' : 'live',
        version: APP_VERSION,
      });
    }

    // =========================================================================
    // 1. AUTHENTICATION ENDPOINTS (/api/auth/*)
    // =========================================================================
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const clientIp = getClientIp(req);
        const authResult = authenticateUser(body.username, body.password, clientIp);
        recordActivityLog({
          actor: authResult.user,
          actionType: 'auth_login',
          actionLabel: 'Đăng nhập hệ thống',
          target: {
            customerName: `Tài khoản: ${authResult.user.username}`,
            sheetName: authResult.user.role === 'admin' ? 'Quản trị Admin' : 'Telesale CRM',
          },
          summary: `Đăng nhập thành công vào hệ thống CRM (${
            authResult.user.telesaleName || authResult.user.username
          } · ${authResult.user.role === 'admin' ? 'Admin' : 'Telesale'})`,
        });
        const cookieVal = encodeURIComponent(authResult.token);
        return sendJson(res, 200, authResult, {
          'Set-Cookie': `crm_bsn_token=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
        });
      } catch (authErr) {
        return sendJson(res, authErr.statusCode || 401, {
          ok: false,
          error: authErr.message || 'Đăng nhập thất bại',
        });
      }
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      return sendJson(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': 'crm_bsn_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        }
      );
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const currentUser = extractRequestUser(req);
      if (!currentUser) {
        return sendJson(res, 401, {
          ok: false,
          authenticated: false,
          error: 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập',
        });
      }
      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        user: currentUser,
      });
    }

    // =========================================================================
    // 2. ADMIN USER & PERMISSION MANAGEMENT ENDPOINTS (/api/admin/*)
    // Chỉ dành riêng cho tài khoản role === 'admin'. Telesale bị chặn 403!
    // =========================================================================
    if (pathname.startsWith('/api/admin/')) {
      const currentUser = extractRequestUser(req);
      if (!currentUser) {
        return sendJson(res, 401, {
          ok: false,
          error: 'Vui lòng đăng nhập để tiếp tục',
        });
      }
      if (currentUser.role !== 'admin') {
        return sendJson(res, 403, {
          ok: false,
          error: 'Tài khoản Telesale không có quyền truy cập trang Quản lý Admin',
        });
      }

      if (pathname === '/api/admin/activity-logs' && req.method === 'GET') {
        const logResult = listActivityLogs({
          actor: parsedUrl.searchParams.get('actor') || 'all',
          actionType: parsedUrl.searchParams.get('actionType') || 'all',
          search: parsedUrl.searchParams.get('search') || '',
          limit: Number(parsedUrl.searchParams.get('limit') || 300),
        });
        return sendJson(
          res,
          200,
          {
            ok: true,
            ...logResult,
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/overview' && req.method === 'GET') {
        const query = {
          period: parsedUrl.searchParams.get('period') || 'month',
          from: parsedUrl.searchParams.get('from') || '',
          to: parsedUrl.searchParams.get('to') || '',
          refresh: parsedUrl.searchParams.get('refresh') || '',
        };
        const overviewData = await getAdminOverviewData(query);
        return sendJson(res, 200, overviewData, {}, req);
      }

      if (pathname === '/api/admin/users' && req.method === 'GET') {
        return sendJson(
          res,
          200,
          {
            ok: true,
            users: listUsersForAdmin(),
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/users' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const created = createUser(body);
        recordActivityLog({
          actor: currentUser,
          actionType: 'user_management',
          actionLabel: 'Cấp tài khoản mới',
          target: {
            customerName: `${created.telesaleName || created.username} (${created.username})`,
            sheetName: 'Quản lý Nhân sự',
          },
          summary: `Cấp tài khoản mới: User "${created.username}" · Tên Telesale: ${
            created.telesaleName || '—'
          } · Vai trò: ${created.role === 'admin' ? 'Admin' : 'Telesale'}`,
        });
        return sendJson(
          res,
          201,
          {
            ok: true,
            user: created,
            users: listUsersForAdmin(),
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/users' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const userId = body.id || parsedUrl.searchParams.get('id');
        const updated = updateUser(userId, body);
        recordActivityLog({
          actor: currentUser,
          actionType: 'user_management',
          actionLabel: 'Cập nhật tài khoản',
          target: {
            customerName: `${updated.telesaleName || updated.username} (${updated.username})`,
            sheetName: 'Quản lý Nhân sự',
          },
          summary: `Cập nhật tài khoản "${updated.username}" (${
            updated.telesaleName || '—'
          }) · Trạng thái: ${updated.active ? 'Đang cấp quyền' : 'Đã khóa'}`,
        });
        return sendJson(
          res,
          200,
          {
            ok: true,
            user: updated,
            users: listUsersForAdmin(),
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/users' && req.method === 'DELETE') {
        const body = await readJsonBody(req).catch(() => ({}));
        const userId = body.id || parsedUrl.searchParams.get('id');
        const existingTarget = listUsersForAdmin().find((u) => u.id === userId);
        deleteUser(userId, currentUser.id);
        recordActivityLog({
          actor: currentUser,
          actionType: 'user_management',
          actionLabel: 'Xóa tài khoản',
          target: {
            customerName: existingTarget
              ? `${existingTarget.telesaleName || existingTarget.username} (${existingTarget.username})`
              : `ID: ${userId}`,
            sheetName: 'Quản lý Nhân sự',
          },
          summary: `Đã xóa tài khoản nhân sự: ${
            existingTarget ? `${existingTarget.username} (${existingTarget.telesaleName})` : userId
          }`,
        });
        return sendJson(
          res,
          200,
          {
            ok: true,
            users: listUsersForAdmin(),
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/telegram-schedule' && req.method === 'GET') {
        return sendJson(
          res,
          200,
          {
            ok: true,
            schedule: getTelegramScheduleConfig(),
          },
          {},
          req
        );
      }

      if (
        pathname === '/api/admin/telegram-schedule' &&
        (req.method === 'POST' || req.method === 'PUT')
      ) {
        const body = await readJsonBody(req);
        const schedule = await updateTelegramScheduleConfig(body);
        recordActivityLog({
          actor: currentUser,
          actionType: 'update_telegram_schedule',
          actionLabel: 'Cài đặt Bot Telegram',
          target: {
            customerName: 'Bot Telegram Tự Động',
            sheetName: 'Cấu hình Hệ thống',
          },
          summary: `Cập nhật lịch tự động báo Telegram: ${
            schedule.enabled ? 'ĐANG BẬT' : 'ĐANG TẮT'
          } · Giờ gửi: ${schedule.sendTime}`,
        });
        return sendJson(
          res,
          200,
          {
            ok: true,
            schedule,
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/leads' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const created = await addAdminLead({ ...body, actor: currentUser });
        const data = await getAllSheetsData(false);
        const scopedData = filterCrmDataForUser(data, currentUser);
        return sendJson(
          res,
          201,
          {
            ...created,
            crmData: scopedData,
          },
          {},
          req
        );
      }

      if (pathname === '/api/admin/leads' && req.method === 'DELETE') {
        const body = await readJsonBody(req).catch(() => ({}));
        const deleted = await deleteAdminLead({ ...body, actor: currentUser });
        const data = await getAllSheetsData(false);
        const scopedData = filterCrmDataForUser(data, currentUser);
        return sendJson(
          res,
          200,
          {
            ...deleted,
            crmData: scopedData,
          },
          {},
          req
        );
      }

      return sendJson(res, 404, { ok: false, error: 'Không tìm thấy API Admin' });
    }

    // =========================================================================
    // 3. PROTECTED CRM DATA ENDPOINTS (/api/crm/*)
    // Không public! Bắt buộc phải có tài khoản được Admin cấp quyền.
    // =========================================================================
    if (pathname.startsWith('/api/crm/')) {
      const currentUser = extractRequestUser(req);
      if (!currentUser) {
        return sendJson(res, 401, {
          ok: false,
          requireAuth: true,
          error: 'Hệ thống CRM nội bộ — Vui lòng đăng nhập tài khoản được cấp quyền',
        });
      }

      if (pathname === '/api/crm/data' && req.method === 'GET') {
        const forceRefresh =
          parsedUrl.searchParams.get('refresh') === '1' ||
          parsedUrl.searchParams.get('refresh') === 'true';
        const data = await getAllSheetsData(forceRefresh);
        const scopedData = filterCrmDataForUser(data, currentUser);
        return sendJson(res, 200, scopedData, {}, req);
      }

      if (pathname === '/api/crm/leads' && req.method === 'POST') {
        if (currentUser.role !== 'admin') {
          return sendJson(res, 403, {
            ok: false,
            error: 'Chỉ tài khoản Admin mới có quyền thêm Data khách hàng mới',
          });
        }
        const body = await readJsonBody(req);
        const created = await addAdminLead({ ...body, actor: currentUser });
        const data = await getAllSheetsData(false);
        const scopedData = filterCrmDataForUser(data, currentUser);
        return sendJson(
          res,
          201,
          {
            ...created,
            crmData: scopedData,
          },
          {},
          req
        );
      }

      if (
        (pathname === '/api/crm/leads' && req.method === 'DELETE') ||
        (pathname === '/api/crm/leads/delete' && req.method === 'POST')
      ) {
        if (currentUser.role !== 'admin') {
          return sendJson(res, 403, {
            ok: false,
            error: 'Chỉ tài khoản Admin mới có quyền xóa Data khách hàng',
          });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const deleted = await deleteAdminLead({
          recordId: body.recordId || body.id || parsedUrl.searchParams.get('id') || '',
          sheetKey: body.sheetKey || parsedUrl.searchParams.get('sheetKey') || 'mkt',
          sheetRowIndex:
            body.sheetRowIndex || parsedUrl.searchParams.get('sheetRowIndex') || 0,
          phone: body.phone || parsedUrl.searchParams.get('phone') || '',
          name: body.name || parsedUrl.searchParams.get('name') || '',
          actor: currentUser,
        });
        const data = await getAllSheetsData(false);
        const scopedData = filterCrmDataForUser(data, currentUser);
        return sendJson(
          res,
          200,
          {
            ...deleted,
            crmData: scopedData,
          },
          {},
          req
        );
      }

      if (pathname === '/api/crm/interaction' && (req.method === 'POST' || req.method === 'PUT')) {
        if (currentUser.role !== 'admin' && currentUser.permissions?.canEdit === false) {
          return sendJson(res, 403, {
            ok: false,
            error: 'Tài khoản của bạn đang ở chế độ Chỉ xem, không có quyền chỉnh sửa dữ liệu',
          });
        }
        const body = await readJsonBody(req);
        if (currentUser.role !== 'admin' && body?.updates?.careHistory !== undefined) {
          return sendJson(res, 403, {
            ok: false,
            error: 'Chỉ tài khoản Admin mới có quyền chỉnh sửa hoặc xóa lịch sử ghi chú đã lưu',
          });
        }
        if (currentUser.role !== 'admin') {
          if (body?.updates?.status !== undefined) {
            const rawTargetStatus = String(body.updates.status || '').trim();
            const upperStatus = rawTargetStatus.toUpperCase();
            const statusInfo = classifyStatus(rawTargetStatus);
            if (
              statusInfo.statusGroup === 'arrived' ||
              upperStatus === 'ĐÃ ĐẾN' ||
              upperStatus.includes('ĐẾN VÀ VỀ')
            ) {
              return sendJson(res, 403, {
                ok: false,
                error: 'Chỉ tài khoản Admin mới có quyền chuyển trạng thái khách sang ĐÃ ĐẾN',
              });
            }
          }
          if (body?.updates?.revenue !== undefined) {
            return sendJson(res, 403, {
              ok: false,
              error: 'Chỉ tài khoản Admin mới có quyền nhập doanh số',
            });
          }
        }
        const updateResult = await updateCustomerInteraction({
          ...body,
          actor: currentUser,
        });
        const data = await getAllSheetsData(false);
        const scopedData = filterCrmDataForUser(data, currentUser);
        return sendJson(
          res,
          200,
          {
            ...updateResult,
            crmData: scopedData,
          },
          {},
          req
        );
      }

      if (pathname === '/api/crm/telegram-reminder' && req.method === 'POST') {
        if (currentUser.role !== 'admin') {
          return sendJson(res, 403, {
            ok: false,
            error: 'Chỉ tài khoản Admin mới có quyền gửi thông báo Telegram',
          });
        }
        const body = await readJsonBody(req);
        const result = await sendTelegramReminder(body);
        recordActivityLog({
          actor: currentUser,
          actionType: 'send_telegram',
          actionLabel: 'Gửi báo lịch Telegram',
          target: {
            customerName: result.customerName || `Danh sách lịch hẹn (${result.dateVn || 'Hôm nay'})`,
            sheetName: 'Nhóm Telegram BSN',
          },
          summary:
            result.mode === 'single'
              ? `Gửi thông tin khách lẻ "${result.customerName}" vào nhóm Telegram`
              : `Gửi danh sách ${result.count ?? 0} khách hẹn ngày ${
                  result.dateVn || ''
                } vào nhóm Telegram`,
        });
        return sendJson(res, 200, result, {}, req);
      }
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    }

    return serveStaticFile(pathname, res, req, parsedUrl.searchParams.has('v'));
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: err?.message || 'Lỗi máy chủ',
    });
  }
}

export function createServer() {
  return http.createServer(handleRequest);
}
