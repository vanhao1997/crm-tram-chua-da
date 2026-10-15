import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import { ROOT_DIR, APP_VERSION } from './config.js';
import {
  getAllSheetsData,
  updateCustomerInteraction,
  sendTelegramReminder,
} from './google-sheets.js';
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

function acceptsGzip(req) {
  const enc = req?.headers?.['accept-encoding'];
  return typeof enc === 'string' && enc.includes('gzip');
}

function sendJson(res, statusCode, payload, extraHeaders = {}, req = null) {
  const rawBody = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
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

function sendStaticFileBuffer(filePath, ext, cacheControl, req, res) {
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
  };

  if (COMPRESSIBLE_EXTS.has(ext) && acceptsGzip(req)) {
    const rawBuf = fs.readFileSync(filePath);
    if (rawBuf.length > 512) {
      const compressed = zlib.gzipSync(rawBuf, { level: zlib.constants.Z_BEST_SPEED });
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      res.end(compressed);
      return;
    }
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function serveStaticFile(reqPath, res, req = null, hasVersionParam = false) {
  const lower = reqPath.toLowerCase();
  if (
    lower.startsWith('/server') ||
    lower.startsWith('/data') ||
    lower.startsWith('/.env') ||
    lower.includes('google-apps-script') ||
    lower.includes('package.json')
  ) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;

  // Kiểm tra trong thư mục public/ trước (chứa brandmark.webp, logo.jpg, favicon.png...)
  const publicCandidate = path.resolve(ROOT_DIR, 'public', `.${cleanPath}`);
  if (
    publicCandidate.startsWith(path.join(ROOT_DIR, 'public')) &&
    fs.existsSync(publicCandidate) &&
    fs.statSync(publicCandidate).isFile()
  ) {
    const ext = path.extname(publicCandidate).toLowerCase();
    sendStaticFileBuffer(publicCandidate, ext, 'public, max-age=86400', req, res);
    return;
  }

  const distDir = path.join(ROOT_DIR, 'dist');
  const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
  const baseDir = hasDist && !reqPath.startsWith('/src/') ? distDir : ROOT_DIR;
  const resolvedPath = path.resolve(baseDir, `.${cleanPath}`);

  if (!resolvedPath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    const ext = path.extname(resolvedPath).toLowerCase();
    const isVersionedAsset = hasVersionParam && (ext === '.js' || ext === '.mjs' || ext === '.css');
    const cacheControl = isVersionedAsset
      ? 'public, max-age=86400'
      : 'no-store, no-cache, must-revalidate';
    sendStaticFileBuffer(resolvedPath, ext, cacheControl, req, res);
    return;
  }

  const indexPath = hasDist
    ? path.join(distDir, 'index.html')
    : path.join(ROOT_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    sendStaticFileBuffer(indexPath, '.html', 'no-store, no-cache, must-revalidate', req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

export async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
        const authResult = authenticateUser(body.username, body.password);
        const cookieVal = encodeURIComponent(authResult.token);
        return sendJson(res, 200, authResult, {
          'Set-Cookie': `crm_bsn_token=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
        });
      } catch (authErr) {
        return sendJson(res, 401, {
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
        deleteUser(userId, currentUser.id);
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
        const updateResult = await updateCustomerInteraction(body);
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
        if (currentUser.role !== 'admin' && currentUser.permissions?.canSendTelegram === false) {
          return sendJson(res, 403, {
            ok: false,
            error: 'Tài khoản của bạn chưa được cấp quyền gửi thông báo Telegram',
          });
        }
        const body = await readJsonBody(req);
        const result = await sendTelegramReminder(body);
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
