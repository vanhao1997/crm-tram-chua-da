import test from 'node:test';
import assert from 'node:assert/strict';
import { google } from 'googleapis';
import { createGoogleSheetsClient } from './google-sheets.js';

test('Google Sheets client resolves configured gids to current tab titles and quoted ranges', async (t) => {
    const originalAuth = google.auth.GoogleAuth;
    const originalSheets = google.sheets;
    const metadataRequests = [];
    let authOptions;

    t.after(() => {
        google.auth.GoogleAuth = originalAuth;
        google.sheets = originalSheets;
    });

    google.auth.GoogleAuth = class {
        constructor(options) {
            authOptions = options;
        }
    };
    google.sheets = () => ({
        spreadsheets: {
            get: async (request, options) => {
                metadataRequests.push({ request, options });
                return {
                    data: {
                        sheets: [
                            { properties: { sheetId: 915093349, title: 'DATA NGUỒN MKT', gridProperties: { columnCount: 179 } } },
                            { properties: { sheetId: 2007161241, title: "KHÁCH ĐẶT HẸN", gridProperties: { columnCount: 180 } } },
                            { properties: { sheetId: 1227076939, title: '2026' } }
                        ]
                    }
                };
            },
            values: {
                batchGet: async () => ({ data: { valueRanges: [] } })
            }
        }
    });

    const client = createGoogleSheetsClient({
        credentialJson: JSON.stringify({ client_email: 'unit@example.test', private_key: 'private' }),
        timeoutMs: 1234
    });
    const resolved = await client.resolveSources([
        { name: 'leads', spreadsheetId: 'crm', tab: 'OLD NAME', sheetId: 915093349 },
        { name: 'marketing', spreadsheetId: 'mkt', tab: 'Wrong 2026', sheetId: 1227076939 }
    ]);

    assert.deepEqual(authOptions.scopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
    assert.equal(authOptions.credentials.client_email, 'unit@example.test');
    assert.equal(resolved[0].tab, 'DATA NGUỒN MKT');
    assert.equal(resolved[0].range, "'DATA NGUỒN MKT'!A:Z");
    assert.equal(resolved[0].identityAvailable, false);
    assert.equal(resolved[1].tab, '2026');
    assert.equal(resolved[1].range, "'2026'!A:Z");
    assert.equal(resolved[1].identityAvailable, false);
    assert.deepEqual(metadataRequests.map(item => item.request.spreadsheetId).sort(), ['crm', 'mkt']);
    assert.equal(metadataRequests[0].request.fields, 'sheets(properties(sheetId,title,gridProperties(columnCount)))');
    assert.equal(metadataRequests[0].options.timeout, 1234);
});

test('Google Sheets client attaches identity ranges without mixing them into source values', async (t) => {
    const originalAuth = google.auth.GoogleAuth;
    const originalSheets = google.sheets;
    const valueRequests = [];

    t.after(() => {
        google.auth.GoogleAuth = originalAuth;
        google.sheets = originalSheets;
    });

    google.auth.GoogleAuth = class {};
    google.sheets = () => ({
        spreadsheets: {
            get: async () => ({ data: { sheets: [] } }),
            values: {
                batchGet: async (request, options) => {
                    valueRequests.push({ request, options });
                    return {
                        data: {
                            valueRanges: [
                                { range: "'DATA NGUỒN MKT'!A:Z", values: [['source-row']] },
                                { range: "'DATA NGUỒN MKT'!FS:FX", values: [['identity-row']] }
                            ]
                        }
                    };
                }
            }
        }
    });

    const client = createGoogleSheetsClient({ timeoutMs: 4321 });
    const values = await client.batchGet({
        spreadsheetId: 'crm',
        ranges: ["'DATA NGUỒN MKT'!A:Z"],
        identityRanges: ["'DATA NGUỒN MKT'!FS:FX"],
        majorDimension: 'ROWS'
    });

    assert.deepEqual(valueRequests[0].request.ranges, ["'DATA NGUỒN MKT'!A:Z", "'DATA NGUỒN MKT'!FS:FX"]);
    assert.equal(valueRequests[0].options.timeout, 4321);
    assert.deepEqual(values, [{
        range: "'DATA NGUỒN MKT'!A:Z",
        values: [['source-row']],
        identityValues: [['identity-row']]
    }]);
});

test('Google Sheets client skips null identity ranges and returns source ranges safely', async (t) => {
    const originalAuth = google.auth.GoogleAuth;
    const originalSheets = google.sheets;
    const valueRequests = [];

    t.after(() => {
        google.auth.GoogleAuth = originalAuth;
        google.sheets = originalSheets;
    });

    google.auth.GoogleAuth = class {};
    google.sheets = () => ({
        spreadsheets: {
            get: async () => ({ data: { sheets: [] } }),
            values: {
                batchGet: async (request) => {
                    valueRequests.push(request);
                    return {
                        data: {
                            valueRanges: [
                                { range: "'DATA NGUỒN MKT'!A:Z", values: [['lead-row']] },
                                { range: "'KHÁCH ĐẶT HẸN'!A:Z", values: [['booked-row']] },
                                { range: "'KHÁCH ĐẶT HẸN'!FS:FX", values: [['booked-id-row']] }
                            ]
                        }
                    };
                }
            }
        }
    });

    const client = createGoogleSheetsClient({ timeoutMs: 4321 });
    const values = await client.batchGet({
        spreadsheetId: 'crm',
        ranges: ["'DATA NGUỒN MKT'!A:Z", "'KHÁCH ĐẶT HẸN'!A:Z"],
        identityRanges: [null, "'KHÁCH ĐẶT HẸN'!FS:FX"]
    });

    assert.deepEqual(valueRequests[0].ranges, ["'DATA NGUỒN MKT'!A:Z", "'KHÁCH ĐẶT HẸN'!A:Z", "'KHÁCH ĐẶT HẸN'!FS:FX"]);
    assert.deepEqual(values, [
        {
            range: "'DATA NGUỒN MKT'!A:Z",
            values: [['lead-row']],
            identityValues: []
        },
        {
            range: "'KHÁCH ĐẶT HẸN'!A:Z",
            values: [['booked-row']],
            identityValues: [['booked-id-row']]
        }
    ]);
});
