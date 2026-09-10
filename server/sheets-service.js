import crypto from 'node:crypto';

const TRANSIENT_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ABORT_ERR',
    'UND_ERR_CONNECT_TIMEOUT'
]);

export class SheetsServiceError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'SheetsServiceError';
        this.code = options.code || 'SHEETS_READ_FAILED';
        this.status = options.status || 502;
        this.transient = Boolean(options.transient);
        this.cause = options.cause;
    }
}

function errorStatus(error) {
    return Number(error?.status || error?.code || error?.response?.status || error?.response?.data?.error?.code) || 0;
}

export function isTransientError(error) {
    if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') return true;
    const status = errorStatus(error);
    if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
    return TRANSIENT_ERROR_CODES.has(String(error?.code || '').toUpperCase());
}

function toError(error, context) {
    if (error instanceof SheetsServiceError) return error;
    const status = errorStatus(error);
    const code = status === 403 || status === 401 ? 'SHEETS_PERMISSION_DENIED' : 'SHEETS_READ_FAILED';
    return new SheetsServiceError(`Google Sheets ${context} failed`, {
        code,
        status: 502,
        transient: isTransientError(error),
        cause: error
    });
}

function timeoutError(context) {
    return new SheetsServiceError(`Google Sheets ${context} timed out`, {
        code: 'SHEETS_TIMEOUT',
        status: 504,
        transient: true
    });
}

function withTimeout(operation, timeoutMs, context) {
    let timer;
    return new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError(context)), timeoutMs);
        Promise.resolve()
            .then(operation)
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(operation, options) {
    const attempts = options.retryCount + 1;
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await withTimeout(operation, options.timeoutMs, options.context);
        } catch (error) {
            lastError = toError(error, options.context);
            if (!lastError.transient || attempt === attempts - 1) throw lastError;
            await options.sleep(Math.min(250 * (attempt + 1), 1_000));
        }
    }

    throw lastError;
}

function cloneResult(result, stale = result.metadata.stale, extraWarnings = []) {
    return {
        values: result.values,
        metadata: {
            ...result.metadata,
            stale,
            warnings: [...new Set([...(result.metadata.warnings || []), ...extraWarnings])]
        }
    };
}

function makeSourceResult(definition, values, metadata) {
    const warnings = [];
    if (!Array.isArray(values) || values.length === 0) warnings.push('empty_source');
    return {
        values: Array.isArray(values) ? values : [],
        metadata: {
            source: definition.name,
            group: definition.group,
            sheetTab: definition.tab,
            spreadsheetId: definition.spreadsheetId,
            rowCount: Array.isArray(values) ? values.length : 0,
            fetchedAt: metadata.fetchedAt,
            snapshotId: metadata.snapshotId,
            stale: Boolean(metadata.stale),
            warnings: [...warnings, ...(metadata.warnings || [])]
        }
    };
}

function createSnapshotId(prefix, timestamp, sequence) {
    return `${prefix}-${timestamp}-${sequence}-${crypto.randomBytes(4).toString('hex')}`;
}

export function createSheetsService({
    sources,
    client,
    now = () => Date.now(),
    sleepFn = sleep,
    cacheMs = 60_000,
    timeoutMs = 15_000,
    retryCount = 2,
    logger = console
}) {
    if (!sources || !client || typeof client.batchGet !== 'function') {
        throw new TypeError('createSheetsService requires sources and a client.batchGet function');
    }

    let sequence = 0;
    let crmCache = null;
    let marketingCache = null;
    let lastGoodCrm = null;
    let lastGoodMarketing = null;
    let crmInFlight = null;
    let marketingInFlight = null;
    let lastSuccessfulFetchAt = null;
    let crmRetryAt = 0;
    let marketingRetryAt = 0;

    const read = (context, request) => retry(
        () => client.batchGet(request),
        { context, retryCount, timeoutMs, sleep: sleepFn }
    );

    async function fetchCrmSnapshot() {
        const definitions = ['leads', 'booked', 'arrived'].map(name => sources[name]);
        const fetchedAtMs = now();
        const valueRanges = await read('CRM snapshot', {
            spreadsheetId: definitions[0].spreadsheetId,
            ranges: definitions.map(definition => definition.range),
            majorDimension: 'ROWS',
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING'
        });

        if (!Array.isArray(valueRanges) || valueRanges.length !== definitions.length) {
            throw new SheetsServiceError('Google Sheets CRM snapshot is incomplete', {
                code: 'CRM_SNAPSHOT_INCOMPLETE',
                transient: false
            });
        }

        const snapshotId = createSnapshotId('crm', fetchedAtMs, ++sequence);
        const metadata = { fetchedAt: new Date(fetchedAtMs).toISOString(), snapshotId, stale: false };
        const snapshot = {
            snapshotId,
            fetchedAt: metadata.fetchedAt,
            sources: {}
        };

        definitions.forEach((definition, index) => {
            snapshot.sources[definition.name] = makeSourceResult(
                definition,
                valueRanges[index]?.values || [],
                metadata
            );
        });

        crmCache = { expiresAt: now() + cacheMs, snapshot };
        lastGoodCrm = snapshot;
        crmRetryAt = 0;
        lastSuccessfulFetchAt = metadata.fetchedAt;
        return snapshot;
    }

    async function getCrmSnapshot() {
        const timestamp = now();
        if (crmCache && timestamp < crmCache.expiresAt) return crmCache.snapshot;
        if (lastGoodCrm && timestamp < crmRetryAt) {
            return {
                ...lastGoodCrm,
                sources: Object.fromEntries(
                    Object.entries(lastGoodCrm.sources).map(([name, result]) => [
                        name,
                        cloneResult(result, true, ['stale_data', 'refresh_throttled'])
                    ])
                )
            };
        }

        if (!crmInFlight) {
            crmInFlight = fetchCrmSnapshot().finally(() => {
                crmInFlight = null;
            });
        }

        try {
            return await crmInFlight;
        } catch (error) {
            if (lastGoodCrm) {
                crmRetryAt = now() + Math.max(cacheMs, 1_000);
                logger.warn?.('CRM Sheets refresh failed; serving last-good snapshot', error.code);
                return {
                    ...lastGoodCrm,
                    sources: Object.fromEntries(
                        Object.entries(lastGoodCrm.sources).map(([name, result]) => [
                            name,
                            cloneResult(result, true, ['stale_data', error.code])
                        ])
                    )
                };
            }
            throw error;
        }
    }

    async function fetchMarketingSnapshot() {
        const definition = sources.marketing;
        const fetchedAtMs = now();
        const valueRanges = await read('Marketing sheet', {
            spreadsheetId: definition.spreadsheetId,
            ranges: [definition.range],
            majorDimension: 'ROWS',
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING'
        });

        if (!Array.isArray(valueRanges) || valueRanges.length !== 1) {
            throw new SheetsServiceError('Google Sheets Marketing snapshot is incomplete', {
                code: 'MARKETING_SNAPSHOT_INCOMPLETE',
                transient: false
            });
        }

        const snapshotId = createSnapshotId('marketing', fetchedAtMs, ++sequence);
        const metadata = { fetchedAt: new Date(fetchedAtMs).toISOString(), snapshotId, stale: false };
        const result = makeSourceResult(definition, valueRanges[0]?.values || [], metadata);
        const snapshot = { snapshotId, fetchedAt: metadata.fetchedAt, result };

        marketingCache = { expiresAt: now() + cacheMs, snapshot };
        lastGoodMarketing = snapshot;
        marketingRetryAt = 0;
        lastSuccessfulFetchAt = metadata.fetchedAt;
        return snapshot;
    }

    async function getMarketingSnapshot() {
        const timestamp = now();
        if (marketingCache && timestamp < marketingCache.expiresAt) return marketingCache.snapshot;
        if (lastGoodMarketing && timestamp < marketingRetryAt) {
            return {
                ...lastGoodMarketing,
                result: cloneResult(lastGoodMarketing.result, true, ['stale_data', 'refresh_throttled'])
            };
        }

        if (!marketingInFlight) {
            marketingInFlight = fetchMarketingSnapshot().finally(() => {
                marketingInFlight = null;
            });
        }

        try {
            return await marketingInFlight;
        } catch (error) {
            if (lastGoodMarketing) {
                marketingRetryAt = now() + Math.max(cacheMs, 1_000);
                logger.warn?.('Marketing Sheets refresh failed; serving last-good snapshot', error.code);
                return {
                    ...lastGoodMarketing,
                    result: cloneResult(lastGoodMarketing.result, true, ['stale_data', error.code])
                };
            }
            throw error;
        }
    }

    return {
        async getSource(source) {
            if (source === 'marketing') {
                const snapshot = await getMarketingSnapshot();
                return snapshot.result;
            }
            if (source === 'leads' || source === 'booked' || source === 'arrived') {
                const snapshot = await getCrmSnapshot();
                return snapshot.sources[source];
            }
            throw new SheetsServiceError('Unknown data source', {
                code: 'UNKNOWN_SOURCE',
                status: 400,
                transient: false
            });
        },
        getStatus() {
            return {
                configured: true,
                lastSuccessfulFetchAt,
                crmSnapshotId: lastGoodCrm?.snapshotId || null,
                marketingSnapshotId: lastGoodMarketing?.snapshotId || null,
                cacheMs,
                timeoutMs,
                retryCount
            };
        },
        clearCache() {
            crmCache = null;
            marketingCache = null;
            crmRetryAt = 0;
            marketingRetryAt = 0;
        }
    };
}
