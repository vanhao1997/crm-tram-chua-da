import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CRM_SHEET_ID = '1HEOYV5QzcOAHSMr6x5zeuem1Vi3V9QdeTvF6lKhGLgk';
const DEFAULT_MARKETING_SHEET_ID = '124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4';

export const SOURCE_NAMES = Object.freeze(['leads', 'booked', 'arrived', 'marketing']);

export function splitList(value) {
    if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

export function quoteSheetName(name) {
    return `'${String(name).replace(/'/g, "''")}'`;
}

function numberEnv(value, fallback, minimum = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
    const nodeEnv = String(env.NODE_ENV || 'development').toLowerCase();
    const production = nodeEnv === 'production';
    const staticDir = path.resolve(cwd, env.STATIC_DIR || 'dist');
    const credentialFile = env.GOOGLE_SERVICE_ACCOUNT_FILE || env.GOOGLE_APPLICATION_CREDENTIALS || '';
    const crmSheetId = env.CRM_SHEET_ID || DEFAULT_CRM_SHEET_ID;
    const marketingSheetId = env.MARKETING_SHEET_ID || DEFAULT_MARKETING_SHEET_ID;
    const allowedClientCidrs = splitList(env.ALLOWED_CLIENT_CIDRS);
    const trustedProxyCidrs = splitList(env.TRUSTED_PROXY_CIDRS);
    const telegramBotToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
    const telegramChatId = String(env.TELEGRAM_CHAT_ID || '').trim();

    if (production && !credentialFile) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_APPLICATION_CREDENTIALS is required in production');
    }
    if (production && allowedClientCidrs.length === 0) {
        throw new Error('ALLOWED_CLIENT_CIDRS is required in production');
    }
    if (production && trustedProxyCidrs.length === 0) {
        throw new Error('TRUSTED_PROXY_CIDRS is required in production');
    }

    const port = numberEnv(env.PORT || env.API_PORT, production ? 3000 : 3001, 1);
    const host = env.HOST || env.API_HOST || (production ? '0.0.0.0' : '127.0.0.1');
    const tabs = {
        leads: env.CRM_LEADS_TAB || 'DATA NGUỒN MKT HẢO',
        booked: env.CRM_BOOKED_TAB || 'KHÁCH ĐẶT HẸN',
        arrived: env.CRM_ARRIVED_TAB || 'KHÁCH ĐÃ ĐẾN',
        marketing: env.MARKETING_TAB || '2026'
    };

    const sources = {
        leads: {
            name: 'leads',
            group: 'crm',
            spreadsheetId: crmSheetId,
            tab: tabs.leads,
            range: `${quoteSheetName(tabs.leads)}!A:Z`
        },
        booked: {
            name: 'booked',
            group: 'crm',
            spreadsheetId: crmSheetId,
            tab: tabs.booked,
            range: `${quoteSheetName(tabs.booked)}!A:Z`
        },
        arrived: {
            name: 'arrived',
            group: 'crm',
            spreadsheetId: crmSheetId,
            tab: tabs.arrived,
            range: `${quoteSheetName(tabs.arrived)}!A:Z`
        },
        marketing: {
            name: 'marketing',
            group: 'marketing',
            spreadsheetId: marketingSheetId,
            tab: tabs.marketing,
            range: `${quoteSheetName(tabs.marketing)}!A:Z`
        }
    };

    return Object.freeze({
        nodeEnv,
        production,
        host,
        port,
        credentialFile,
        staticDir,
        serveStatic: production || String(env.SERVE_STATIC || '').toLowerCase() === 'true',
        timezone: env.BSN_TIMEZONE || 'Asia/Ho_Chi_Minh',
        cacheMs: numberEnv(env.SHEETS_CACHE_MS, 60_000, 0),
        timeoutMs: numberEnv(env.SHEETS_TIMEOUT_MS, 15_000, 1),
        retryCount: numberEnv(env.SHEETS_RETRY_COUNT, 2, 0),
        telegramBotToken,
        telegramChatId,
        trustedProxyCidrs,
        allowedClientCidrs,
        sources
    });
}

export function validateSourceName(source) {
    return SOURCE_NAMES.includes(source);
}

export function assertStartupConfig(config, fsModule = fs) {
    const errors = [];

    if (config.production && config.credentialFile && !fsModule.existsSync(config.credentialFile)) {
        errors.push('Google service-account secret file is not mounted');
    }
    if (config.production && config.serveStatic && !fsModule.existsSync(config.staticDir)) {
        errors.push('Built static directory is missing');
    }

    if (errors.length > 0) {
        throw new Error(`Invalid server configuration: ${errors.join('; ')}`);
    }
}
