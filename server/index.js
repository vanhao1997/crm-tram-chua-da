import dotenv from 'dotenv';
import { createApp } from './app.js';
import { assertStartupConfig, loadConfig } from './config.js';
import { createGoogleSheetsClient } from './google-sheets.js';
import { createSheetsService } from './sheets-service.js';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

export function startServer({ config = loadConfig(), logger = console } = {}) {
    assertStartupConfig(config);
    const client = createGoogleSheetsClient(config);
    const service = createSheetsService({
        sources: config.sources,
        client,
        cacheMs: config.cacheMs,
        timeoutMs: config.timeoutMs,
        retryCount: config.retryCount,
        maxStaleMs: config.maxStaleMs,
        identityColumns: config.identityColumns,
        logger
    });
    const app = createApp({ service, config, logger });
    const server = app.listen(config.port, config.host, () => {
        logger.log?.(`BSN Sheets API listening on ${config.host}:${config.port}`);
    });
    const reconcile = () => service.getIntegrity().catch(error => logger.warn?.('Scheduled reconciliation failed', error.code || 'UNKNOWN'));
    const timer = config.reconcileIntervalMs > 0 ? setInterval(reconcile, config.reconcileIntervalMs) : null;
    timer?.unref();
    reconcile();

    function shutdown(signal) {
        if (timer) clearInterval(timer);
        logger.log?.(`Received ${signal}; shutting down`);
        server.close(error => {
            if (error) {
                logger.error?.('Shutdown failed');
                process.exitCode = 1;
            }
        });
    }

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
    return { app, server, service };
}

const isMainModule = process.argv[1] && new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href === import.meta.url;
if (isMainModule) {
    try {
        startServer();
    } catch (error) {
        console.error('BSN Sheets API failed to start:', error.message);
        process.exitCode = 1;
    }
}
