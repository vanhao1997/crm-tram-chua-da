import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore .env read errors
  }
}

loadDotEnv();

export const PORT = Number(process.env.PORT || 3001);
export const HOST = process.env.HOST || '0.0.0.0';
export const APP_VERSION = process.env.APP_VERSION || '2026.10.16-r22';
export const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1HEOYV5QzcOAHSMr6x5zeuem1Vi3V9QdeTvF6lKhGLgk';
export const DEFAULT_APPS_SCRIPT_URL =
  process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbwwxIGcjNrO4KYcK2qcC9JCEhGAXFn-i82XW94g6WRlaKX8VCgFxoEkPiIDV15jIVFwnQ/exec';
const FALLBACK_TG_TOKEN_B64 =
  'ODgyMDk4MDkyMTpBQUhYWTgycHBQVVZvRmFxWXk2eEdTclB4UUJwLTlJdXg5RQ==';
export const DEFAULT_TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  Buffer.from(FALLBACK_TG_TOKEN_B64, 'base64').toString('utf8');
export const DEFAULT_TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || '-1004467285585';


export const SHEETS_CONFIG = {
  mkt: {
    key: 'mkt',
    name: '1) DATA NGUỒN MKT',
    shortName: '1) Data Nguồn MKT',
    gid: process.env.SHEET_GID_MKT || '915093349',
    description: 'Danh sách data MKT tự động đổ về — Telesale gọi, chuyển tình trạng (Cột I), gán tên (Cột L) & ghi Note (Cột M)',
  },
  booked: {
    key: 'booked',
    name: '2) KHÁCH ĐẶT HẸN',
    shortName: '2) Khách Đặt Hẹn',
    gid: process.env.SHEET_GID_BOOKED || '2007161241',
    description: 'Danh sách khách đang có lịch hẹn — Theo dõi nhắc lịch, dời lịch, hủy lịch & xác nhận khách đến',
  },
  arrived: {
    key: 'arrived',
    name: '3) KHÁCH ĐÃ ĐẾN',
    shortName: '3) Khách Đã Đến',
    gid: process.env.SHEET_GID_ARRIVED || '1566321838',
    description: 'Danh sách khách thực tế đã đến cơ sở & doanh số phát sinh (Cột V, W)',
  },
};

export const DEFAULT_TELESALE_LIST = (
  process.env.TELESALE_LIST || 'THỊNH,PHÚ,TELESALE 3,TELESALE 4,TELESALE 5'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(0, 5);

while (DEFAULT_TELESALE_LIST.length < 5) {
  DEFAULT_TELESALE_LIST.push(`TELESALE ${DEFAULT_TELESALE_LIST.length + 1}`);
}

export const STATUS_OPTIONS = [
  { value: '', label: 'Chưa gọi (Mới)', group: 'new', color: 'amber' },
  { value: 'ĐẶT HẸN', label: 'Đặt Hẹn', group: 'booked', color: 'emerald' },
  { value: 'Hẹn Gọi Lại', label: 'Hẹn Gọi Lại', group: 'followup', color: 'blue' },
  { value: 'Nhu Cầu', label: 'Nhu Cầu (Care thêm)', group: 'followup', color: 'indigo' },
  { value: 'Không Nghe Máy', label: 'Không Nghe Máy', group: 'unreachable', color: 'orange' },
  { value: 'Thuê Bao', label: 'Thuê Bao', group: 'unreachable', color: 'orange' },
  { value: 'DỜI LỊCH', label: 'Dời Lịch', group: 'booked', color: 'purple' },
  { value: 'ĐÃ ĐẾN', label: 'Đã Đến', group: 'arrived', color: 'teal', adminOnly: true },
  { value: 'ĐẾN VÀ VỀ', label: 'Đến Và Về', group: 'arrived', color: 'indigo', adminOnly: true },
  { value: 'CHƯA ĐẾN', label: 'Chưa Đến', group: 'followup', color: 'indigo' },
  { value: 'HỦY LỊCH', label: 'Hủy Lịch', group: 'lost', color: 'rose' },
  { value: 'Không Hoàn Thành', label: 'Không Hoàn Thành', group: 'lost', color: 'slate' },
  { value: 'Từ Chối', label: 'Từ Chối', group: 'lost', color: 'rose' },
  { value: 'Ở xa', label: 'Ở Xa', group: 'lost', color: 'slate' },
  { value: 'Sai Số', label: 'Sai Số', group: 'lost', color: 'red' },
];

export const SERVICE_OPTIONS = [
  'Nâng cơ 999k',
  'Mũi sợi 1tr999',
  'Mũi sợi 2tr999',
];

export const SOURCE_OPTIONS = [
  'Ads FB Mess',
  'Giới thiệu',
  'Gọi điện trực tiếp',
  'Google',
];

export const QUICK_NOTE_TEMPLATES = [
  '2c knm, đã nt zl care',
  '3c thuê bao',
  'Đang bận làm, hẹn chiều gọi lại',
  'Mũi chưa từng làm, đã kbzl gửi vị trí tự qua',
  'Mũi đã làm chỉ, muốn cao thêm, đã kbzl',
  'Hỗ trợ đặt Grab đón khách',
  'Nhắc lịch cho khách, khách xác nhận qua đúng giờ',
  'Khách bận đột xuất, xin dời lịch qua ngày khác',
];

export function buildCsvExportUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export function buildSpreadsheetUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid || '915093349'}`;
}
