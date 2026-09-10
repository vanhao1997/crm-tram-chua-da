import { google } from 'googleapis';

export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export function createGoogleSheetsClient(config) {
    const authOptions = {
        scopes: [GOOGLE_SHEETS_READONLY_SCOPE]
    };

    if (config.credentialFile) authOptions.keyFile = config.credentialFile;

    const auth = new google.auth.GoogleAuth(authOptions);
    const sheets = google.sheets({ version: 'v4', auth });

    return {
        async batchGet(options) {
            const response = await sheets.spreadsheets.values.batchGet(options);
            return response.data.valueRanges || [];
        }
    };
}
