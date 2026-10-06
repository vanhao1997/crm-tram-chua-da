import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStartupConfig, loadConfig, quoteSheetName } from './config.js';

test('source configuration is fixed to the four supported source names', () => {
    const config = loadConfig({
        NODE_ENV: 'development',
        CRM_SHEET_ID: 'crm-sheet',
        MARKETING_SHEET_ID: 'marketing-sheet',
        CRM_LEADS_TAB: 'DATA NGUỒN MKT',
        CRM_BOOKED_TAB: 'KHÁCH ĐẶT HẸN',
        CRM_ARRIVED_TAB: 'KHÁCH ĐÃ ĐẾN',
        MARKETING_TAB: '2026',
        CRM_LEADS_GID: '915093349'
    });

    assert.deepEqual(Object.keys(config.sources), ['leads', 'booked', 'arrived', 'marketing']);
    assert.equal(config.sources.leads.range, "'DATA NGUỒN MKT'!A:Z");
    assert.equal(config.sources.leads.sheetId, 915093349);
    assert.equal(quoteSheetName("O'Brien"), "'O''Brien'");
});

test('default production source identities use stable gids and current CRM lead tab title', () => {
    const config = loadConfig({ NODE_ENV: 'development' });

    assert.equal(config.sources.leads.tab, 'DATA NGUỒN MKT');
    assert.equal(config.sources.leads.sheetId, 915093349);
    assert.equal(config.sources.booked.sheetId, 2007161241);
    assert.equal(config.sources.arrived.sheetId, 1566321838);
    assert.equal(config.sources.marketing.sheetId, 1227076939);
    assert.equal(config.maxStaleMs, 15 * 60_000);
    assert.equal(config.identityColumns, 'FS:FX');
});

test('production startup checks mounted static directory and credential without exposing paths', () => {
    const config = loadConfig({
        NODE_ENV: 'production',
        GOOGLE_SERVICE_ACCOUNT_FILE: '/run/secrets/google-service-account.json',
        TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
        ALLOWED_CLIENT_CIDRS: '127.0.0.1/32',
        STATIC_DIR: 'dist'
    });
    assert.throws(
        () => assertStartupConfig(config, { existsSync: () => false }),
        /secret file is not mounted/
    );
});

test('runtime source commit is exposed when the Docker image has only the default dev version', () => {
    assert.equal(loadConfig({ APP_VERSION: 'dev', SOURCE_COMMIT: 'abcdef0123456789' }).appVersion, 'abcdef0123456789');
    assert.equal(loadConfig({ APP_VERSION: 'release-version', SOURCE_COMMIT: 'abcdef0123456789' }).appVersion, 'release-version');
});
