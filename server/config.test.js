import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStartupConfig, loadConfig, quoteSheetName } from './config.js';

test('source configuration is fixed to the four supported source names', () => {
    const config = loadConfig({
        NODE_ENV: 'development',
        CRM_SHEET_ID: 'crm-sheet',
        MARKETING_SHEET_ID: 'marketing-sheet',
        CRM_LEADS_TAB: 'DATA NGUỒN MKT HẢO',
        CRM_BOOKED_TAB: 'KHÁCH ĐẶT HẸN',
        CRM_ARRIVED_TAB: 'KHÁCH ĐÃ ĐẾN',
        MARKETING_TAB: '2026'
    });

    assert.deepEqual(Object.keys(config.sources), ['leads', 'booked', 'arrived', 'marketing']);
    assert.equal(config.sources.leads.range, "'DATA NGUỒN MKT HẢO'!A:Z");
    assert.equal(quoteSheetName("O'Brien"), "'O''Brien'");
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
