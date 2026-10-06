import { google } from 'googleapis';
import { quoteSheetName } from './config.js';

export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export function createGoogleSheetsClient(config) {
    const authOptions = {
        scopes: [GOOGLE_SHEETS_READONLY_SCOPE]
    };

    if (config.credentialJson) {
        try { authOptions.credentials = JSON.parse(config.credentialJson); }
        catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is invalid'); }
    } else if (config.credentialFile) authOptions.keyFile = config.credentialFile;

    const auth = new google.auth.GoogleAuth(authOptions);
    const sheets = google.sheets({ version: 'v4', auth });
    const metadataCache = new Map();

    async function resolveSources(definitions) {
        const ids = [...new Set(definitions.map(source => source.spreadsheetId))];
        await Promise.all(ids.map(async id => {
            const cached = metadataCache.get(id);
            if (cached && Date.now() < cached.expiresAt) return;
            const response = await sheets.spreadsheets.get({
                spreadsheetId: id,
                fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))'
            }, { timeout: config.timeoutMs });
            metadataCache.set(id, { sheets: response.data.sheets || [], expiresAt: Date.now() + 60_000 });
        }));
        return definitions.map(definition => {
            const tabs = metadataCache.get(definition.spreadsheetId).sheets;
            const tab = tabs.find(sheet => definition.sheetId != null
                ? sheet.properties.sheetId === definition.sheetId
                : sheet.properties.title === definition.tab);
            if (!tab) {
                const error = new Error('Configured source tab does not exist');
                error.code = 'SHEETS_SOURCE_MISSING';
                throw error;
            }
            const title = tab.properties.title;
            return { ...definition, tab: title, sheetId: tab.properties.sheetId,
                identityAvailable: (tab.properties.gridProperties?.columnCount || 0) >= 180,
                range: `${quoteSheetName(title)}!A:Z` };
        });
    }

    return {
        resolveSources,
        async batchGet(options) {
            const { identityRanges = [], sourceDefinitions, ...request } = options;
            const count = request.ranges.length;
            const validIdentityRanges = identityRanges.filter(Boolean);
            const response = await sheets.spreadsheets.values.batchGet({
                ...request, ranges: [...request.ranges, ...validIdentityRanges]
            }, { timeout: config.timeoutMs });
            const ranges = response.data.valueRanges || [];
            if (ranges.length !== count + validIdentityRanges.length) return [];
            let identityIndex = count;
            return ranges.slice(0, count).map((range, index) => ({ ...range,
                ...(identityRanges.length ? { identityValues: identityRanges[index]
                    ? ranges[identityIndex++]?.values || [] : [] } : {}) }));
        }
    };
}
