import { telegramRequest } from './telegram.js';
import { formatTelegramPhone } from './telegram-message.js';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { SOURCE_NAMES, validateSourceName, quoteSheetName } from './config.js';
import { SheetsServiceError } from './sheets-service.js';
import { applyNetworkSecurity } from './network.js';

function publicError(error) {
    if (error instanceof SheetsServiceError) {
        return { error: error.message, code: error.code };
    }
    return { error: 'Request failed', code: 'REQUEST_FAILED' };
}

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function sourceIdentity(config, source, metadata = {}) {
    const definition = config.sources?.[source] || {};
    return {
        source,
        group: metadata.group ?? definition.group ?? null,
        spreadsheetId: metadata.spreadsheetId ?? definition.spreadsheetId ?? null,
        sheetTab: metadata.sheetTab ?? definition.tab ?? null,
        sheetId: metadata.sheetId ?? definition.sheetId ?? null,
        range: metadata.sheetTab ? `${quoteSheetName(metadata.sheetTab)}!A:Z` : definition.range ?? null
    };
}

function withSourceIdentity(config, source, metadata = {}) {
    return {
        ...metadata,
        sourceIdentity: sourceIdentity(config, source, metadata)
    };
}

function sourceStatusMap(status = {}, config = {}) {
    const rawSources = isObject(status.sources) ? status.sources : {};
    const rawSourceStatus = isObject(status.sourceStatus) ? status.sourceStatus : {};
    const freshness = isObject(status.freshness) ? status.freshness : {};

    return Object.fromEntries(SOURCE_NAMES.map(source => {
        const definition = config.sources?.[source] || {};
        const entry = isObject(rawSources[source])
            ? rawSources[source]
            : (isObject(rawSourceStatus[source]) ? rawSourceStatus[source] : {});
        const group = entry.group ?? definition.group ?? null;
        const groupFreshness = isObject(freshness[group]) ? freshness[group] : {};
        const statusText = entry.status ?? groupFreshness.status ?? null;
        const snapshotId = entry.snapshotId
            ?? (group === 'marketing' ? status.marketingSnapshotId : null)
            ?? (group === 'crm' ? status.crmSnapshotId : null)
            ?? null;

        return [source, {
            source,
            group,
            status: statusText,
            stale: typeof entry.stale === 'boolean' ? entry.stale : (statusText === 'stale' || statusText === 'expired' || status.stale === true),
            expired: typeof entry.expired === 'boolean' ? entry.expired : (statusText === 'expired' || status.expired === true),
            available: typeof entry.available === 'boolean'
                ? entry.available
                : (statusText ? !['unavailable', 'expired'].includes(String(statusText).toLowerCase()) : (typeof status.available === 'boolean' ? status.available : null)),
            fetchedAt: entry.fetchedAt ?? entry.lastSuccessfulFetchAt ?? groupFreshness.fetchedAt ?? null,
            snapshotId,
            warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
            lastError: entry.lastError ?? groupFreshness.lastError ?? null
        }];
    }));
}

function unavailableStatus(value) {
    if (!isObject(value)) return false;
    if (value.configured === false || value.available === false || value.unavailable === true || value.expired === true) return true;
    if (value.credentialsValid === false || value.credentialValid === false || value.invalidCredentials === true) return true;
    if (['unavailable', 'expired', 'invalid_credentials'].includes(String(value.status || '').toLowerCase())) return true;
    if (['SHEETS_PERMISSION_DENIED', 'GOOGLE_CREDENTIALS_INVALID', 'GOOGLE_AUTH_FAILED'].includes(String(value.code || ''))) return true;
    return false;
}

function healthSnapshot(service, config) {
    const serviceStatus = service.getStatus?.() || { configured: true };
    const sources = sourceStatusMap(serviceStatus, config);
    const ready = !unavailableStatus(serviceStatus) && !Object.values(sources).some(unavailableStatus);
    return { serviceStatus, sources, ready };
}

export function createApp({ service, config, logger = console, sendTelegram = telegramRequest }) {
    if (!service || !config) throw new TypeError('createApp requires service and config');

    const app = express();
    app.disable('x-powered-by');
    applyNetworkSecurity(app, {
        production: config.production,
        trustedProxyCidrs: config.trustedProxyCidrs,
        allowedClientCidrs: config.allowedClientCidrs
    });

    app.get('/api/version', (req, res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); res.json({ version: config.appVersion || 'dev' }); });

    app.get('/api/health/live', (req, res) => {
        res.json({ ok: true, status: 'live', readonly: true });
    });

    app.get('/api/health/ready', (req, res) => {
        const { serviceStatus, sources, ready } = healthSnapshot(service, config);
        res.status(ready ? 200 : 503).json({
            ...serviceStatus,
            ok: ready,
            status: ready ? 'ready' : 'not_ready',
            readonly: true,
            sources
        });
    });

    app.get('/api/health', (req, res) => {
        const { serviceStatus, sources } = healthSnapshot(service, config);
        res.json({
            ...serviceStatus,
            ok: true,
            provider: 'google-sheets-api',
            readonly: true,
            telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
            sources
        });
    });

    app.get('/api/telegram/settings', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ botConfigured: Boolean(config.telegramBotToken), defaultChatId: config.telegramChatId || '' });
    });

    app.post('/api/telegram/send-record', express.json({ limit: '16kb' }), async (req, res) => {
        const override = req.body?.chatId;
        if (override != null && (typeof override !== 'string' || (override.trim() && (!/^-[1-9]\d{0,15}$/.test(override.trim()) || !Number.isSafeInteger(Number(override)))))) {
            return res.status(400).json({ error: 'Group ID phải là số âm hợp lệ', code: 'INVALID_CHAT_ID' });
        }
        const chatId = override?.trim() || config.telegramChatId;
        if (!config.telegramBotToken || !chatId) return res.status(503).json({ error: 'Telegram chưa được cấu hình', code: 'TELEGRAM_NOT_CONFIGURED' });
        const text = String(req.body?.text || '').trim();
        if (!text || text.length > 4096) return res.status(400).json({ error: 'Nội dung bản ghi không hợp lệ', code: 'INVALID_MESSAGE' });
        try {
            const message = formatTelegramPhone(text);
            if (message.text.length > 4096) return res.status(400).json({ error: 'Nội dung bản ghi quá dài', code: 'INVALID_MESSAGE' });
            const { ok, payload } = await sendTelegram(config.telegramBotToken, 'sendMessage', { chat_id: chatId, ...message, disable_web_page_preview: true });
            if (!ok || payload.ok !== true) return res.status(502).json({ error: 'Telegram không gửi được tin nhắn', code: 'TELEGRAM_SEND_FAILED' });
            return res.json({ ok: true, sentAt: new Date().toISOString() });
        } catch { return res.status(502).json({ error: 'Không kết nối được Telegram', code: 'TELEGRAM_NETWORK_FAILED' }); }
    });

    app.get('/api/integrity', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (typeof service.getIntegrity !== 'function') {
            return res.status(501).json({ error: 'Integrity report unavailable', code: 'INTEGRITY_NOT_IMPLEMENTED' });
        }

        try {
            const result = await service.getIntegrity();
            return res.json(isObject(result) ? result : { result });
        } catch (error) {
            logger.error?.('Integrity request failed', error.code || 'UNKNOWN');
            const body = publicError(error);
            return res.status(error.status && error.status >= 400 ? error.status : 502).json(body);
        }
    });

    app.get('/api/sheets', async (req, res) => {
        const query = req.query || {};
        const queryKeys = Object.keys(query);
        if ('id' in query || 'range' in query || queryKeys.some(key => key !== 'source')) {
            return res.status(400).json({
                error: 'Only an allowlisted source is accepted',
                code: 'INVALID_SOURCE_REQUEST',
                allowedSources: SOURCE_NAMES
            });
        }

        const source = String(query.source || '').trim().toLowerCase();
        if (!validateSourceName(source)) {
            return res.status(400).json({
                error: 'Unknown data source',
                code: 'UNKNOWN_SOURCE',
                allowedSources: SOURCE_NAMES
            });
        }

        try {
            const result = await service.getSource(source);
            res.set('Cache-Control', 'no-store');
            return res.json({
                values: result.values,
                identities: Array.isArray(result.identities) ? result.identities : [],
                metadata: withSourceIdentity(config, source, result.metadata)
            });
        } catch (error) {
            logger.error?.('Sheets request failed', error.code || 'UNKNOWN');
            const body = publicError(error);
            return res.status(error.status && error.status >= 400 ? error.status : 502).json(body);
        }
    });

    if (config.serveStatic && fs.existsSync(config.staticDir)) {
        app.use(express.static(config.staticDir, {
            index: 'index.html',
            redirect: false
        }));
        app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
            const indexPath = path.join(config.staticDir, 'index.html');
            if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
            return res.status(404).send('Not found');
        });
    }

    app.use((error, req, res, next) => {
        logger.error?.('Unhandled request error', error?.code || 'UNKNOWN');
        if (res.headersSent) return next(error);
        return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    });

    return app;
}

