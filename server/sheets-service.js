import crypto from 'node:crypto';
import { calendarDay, isCustomerRow, inspectCrm, parseIdentities, reconcileSources } from './integrity.js';
import { quoteSheetName } from './config.js';
import { completeAppointments, deriveMarketing } from './derived-data.js';

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
    const code = error?.code === 'SHEETS_SOURCE_MISSING' ? 'SHEETS_SOURCE_MISSING'
        : status === 400 ? 'SHEETS_INVALID_RANGE'
        : status === 403 || status === 401 ? 'SHEETS_PERMISSION_DENIED' : 'SHEETS_READ_FAILED';
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
        identities: result.identities,
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
            sheetId: definition.sheetId ?? null,
            identityAvailable: definition.identityAvailable ?? false,
            workspaceId: crypto.createHash('sha256').update(definition.spreadsheetId).digest('hex').slice(0, 16),
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
    maxStaleMs = 15 * 60_000,
    identityColumns = 'FS:FX',
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
    let crmError = null;
    let marketingError = null;
    let lastIntegrity = null;
    let lastIntegritySignature = null;

    const read = (context, request) => retry(
        () => client.batchGet(request),
        { context, retryCount, timeoutMs, sleep: sleepFn }
    );

    const resolve = async definitions => typeof client.resolveSources === 'function'
        ? retry(() => client.resolveSources(definitions),
            { context: 'source identity', retryCount, timeoutMs, sleep: sleepFn }) : definitions;
    const age = snapshot => snapshot ? Math.max(0, now() - Date.parse(snapshot.fetchedAt)) : null;
    const withinStaleLimit = snapshot => snapshot && age(snapshot) <= maxStaleMs;
    function requireUsable(snapshot) {
        if (!withinStaleLimit(snapshot)) throw new SheetsServiceError('Source snapshot is too old to use', {
            code: 'SHEETS_SNAPSHOT_EXPIRED', status: 503, transient: false
        });
    }

    async function fetchCrmSnapshot() {
        const definitions = await resolve(['leads', 'booked', 'arrived'].map(name => sources[name]));
        const fetchedAtMs = now();
        const valueRanges = await read('CRM snapshot', {
            spreadsheetId: definitions[0].spreadsheetId,
            ranges: definitions.map(definition => definition.range),
            ...(client.resolveSources ? { identityRanges: definitions.map(definition => definition.identityAvailable === false
                ? null : `${quoteSheetName(definition.tab)}!${identityColumns}`),
                sourceDefinitions: definitions } : {}),
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
            snapshot.sources[definition.name].identities = parseIdentities(valueRanges[index]?.identityValues, snapshot.sources[definition.name].values.length);
        });

        snapshot.sources.booked = completeAppointments(snapshot.sources);
        for (const [name, result] of Object.entries(snapshot.sources)) {
            const days = result.values.filter(isCustomerRow).map(row => calendarDay(name === 'leads' ? row[1]
                : name === 'booked' ? row[10] : row[10] || row[1])).filter(Boolean);
            result.metadata.latestEventDate = days.sort().at(-1) || null;
        }
        snapshot.integrity = inspectCrm(snapshot, metadata.fetchedAt);
        if (snapshot.sources.booked.metadata.derivedCount) snapshot.integrity.issues.push({
            code: 'APPOINTMENTS_DERIVED', severity: 'warning', source: 'booked', corrected: true,
            count: snapshot.sources.booked.metadata.derivedCount,
            message: 'Lịch hẹn xác nhận được tính từ lead; tab lịch hẹn chưa có đủ bản ghi.'
        });
        for (const result of Object.values(snapshot.sources)) result.metadata.integrity = snapshot.integrity;

        crmCache = { expiresAt: now() + cacheMs, snapshot };
        lastGoodCrm = snapshot;
        crmRetryAt = 0;
        crmError = null;
        lastSuccessfulFetchAt = metadata.fetchedAt;
        return snapshot;
    }

    async function getCrmSnapshot() {
        const timestamp = now();
        if (crmCache && timestamp < crmCache.expiresAt && withinStaleLimit(crmCache.snapshot)) return crmCache.snapshot;
        if (lastGoodCrm && timestamp < crmRetryAt) {
            requireUsable(lastGoodCrm);
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
            crmError = error.code || 'SHEETS_READ_FAILED';
            if (lastGoodCrm) {
                requireUsable(lastGoodCrm);
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
        const [definition] = await resolve([sources.marketing]);
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
        marketingError = null;
        lastSuccessfulFetchAt = metadata.fetchedAt;
        return snapshot;
    }

    async function getMarketingSnapshot() {
        const timestamp = now();
        if (marketingCache && timestamp < marketingCache.expiresAt && withinStaleLimit(marketingCache.snapshot)) return marketingCache.snapshot;
        if (lastGoodMarketing && timestamp < marketingRetryAt) {
            requireUsable(lastGoodMarketing);
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
            marketingError = error.code || 'SHEETS_READ_FAILED';
            if (lastGoodMarketing) {
                requireUsable(lastGoodMarketing);
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

    function reconciledMarketing(crm, marketing, { dailyIssues = false } = {}) {
        const checkedAt = new Date(now()).toISOString();
        const freshCrm = crm && !Object.values(crm.sources).some(source => source.metadata.stale);
        const result = freshCrm ? deriveMarketing(crm, marketing, checkedAt) : cloneResult(marketing);
        if (!freshCrm) {
            result.values = result.values.map(row => {
                if (!calendarDay(row[0])) return row;
                const unavailable = [...row];
                for (let col = 6; col <= 16; col++) unavailable[col] = null;
                return unavailable;
            });
            result.metadata.calculationSource = 'crm_unavailable';
        }
        const integrity = reconcileSources(crm, result, checkedAt);
        const corrected = new Map();
        for (const issue of result.metadata.correctedIssues || []) {
            const monthKey = issue.dateKey.slice(0, 7);
            const key = `${issue.code}:${monthKey}`;
            if (!corrected.has(key)) corrected.set(key, { code: issue.code, severity: issue.severity,
                monthKey, corrected: true, count: 0, message: issue.message });
            corrected.get(key).count++;
        }
        integrity.issues.push(...(dailyIssues ? result.metadata.correctedIssues || [] : corrected.values()));
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
            .formatToParts(new Date(checkedAt));
        const monthKey = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
        if (freshCrm && result.values.some(row => calendarDay(row[0])?.startsWith(monthKey) && row[3] > 0)
            && (!crm.sources.arrived.metadata.latestEventDate || crm.sources.arrived.metadata.latestEventDate < `${monthKey}-01`)) {
            integrity.issues.push({ code: 'VISITS_NOT_RECORDED_THIS_MONTH', severity: 'critical', source: 'arrived', monthKey,
                latestEventDate: crm.sources.arrived.metadata.latestEventDate,
                message: 'Chưa có khách đến được ghi nhận tháng này; xác nhận nhập đủ dữ liệu trước khi quyết định ngân sách.' });
        }
        integrity.ok = !integrity.issues.some(issue => issue.severity === 'critical');
        delete result.metadata.correctedIssues;
        result.metadata.integrity = integrity;
        return result;
    }

    return {
        async getOverviewSnapshot() {
            const [crm, marketing] = await Promise.allSettled([getCrmSnapshot(), getMarketingSnapshot()]);
            const crmSnapshot = crm.status === 'fulfilled' ? crm.value : null;
            const marketingResult = marketing.status === 'fulfilled' ? reconciledMarketing(crmSnapshot, marketing.value.result, { dailyIssues: true }) : null;
            const integrity = marketingResult?.metadata.integrity || reconcileSources(crmSnapshot, null, new Date(now()).toISOString());
            lastIntegrity = integrity;
            return { sources: {
                ...(crmSnapshot?.sources || {}),
                ...(marketingResult ? { marketing: marketingResult } : {})
            }, integrity };
        },
        async getSource(source) {
            if (source === 'marketing') {
                const [marketing, crm] = await Promise.allSettled([getMarketingSnapshot(), getCrmSnapshot()]);
                if (marketing.status !== 'fulfilled') throw marketing.reason;
                const result = reconciledMarketing(crm.status === 'fulfilled' ? crm.value : null, marketing.value.result);
                lastIntegrity = result.metadata.integrity;
                return result;
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
        async getIntegrity() {
            const [crm, marketing] = await Promise.allSettled([getCrmSnapshot(), getMarketingSnapshot()]);
            const result = marketing.status === 'fulfilled' ? reconciledMarketing(
                crm.status === 'fulfilled' ? crm.value : null, marketing.value.result).metadata.integrity
                : reconcileSources(crm.status === 'fulfilled' ? crm.value : null, null, new Date(now()).toISOString());
            if (marketing.status !== 'fulfilled') result.issues.push({ code: 'MARKETING_UNAVAILABLE', severity: 'critical',
                message: 'Nguồn Marketing chưa có snapshot mới để đối soát.' });
            result.ok = !result.issues.some(issue => issue.severity === 'critical');
            lastIntegrity = result;
            const signature = JSON.stringify(result.issues.map(issue => [issue.code, issue.source, issue.dateKey, issue.monthKey, issue.row, issue.count]));
            if (signature !== lastIntegritySignature) {
                logger.info?.('Source reconciliation changed', { ok: result.ok, issueCount: result.issues.length,
                    crmSnapshotId: result.crmSnapshotId, marketingSnapshotId: result.marketingSnapshotId });
                lastIntegritySignature = signature;
            }
            return result;
        },
        getStatus() {
            const freshness = (snapshot, error) => ({
                fetchedAt: snapshot?.fetchedAt || null,
                ageMs: age(snapshot),
                status: !snapshot ? (error ? 'unavailable' : 'pending') : age(snapshot) > maxStaleMs ? 'expired' : error ? 'stale' : 'fresh',
                lastError: error
            });
            const crm = freshness(lastGoodCrm, crmError), marketing = freshness(lastGoodMarketing, marketingError);
            return {
                configured: true,
                sourcesReady: ![crm, marketing].some(source => ['unavailable', 'expired', 'stale'].includes(source.status)),
                freshness: { crm, marketing },
                sources: Object.fromEntries([
                    ['leads', crm],
                    ['booked', crm],
                    ['arrived', crm],
                    ['marketing', marketing]
                ].map(([source, freshness]) => [source, {
                    source,
                    group: sources[source]?.group || null,
                    status: freshness.status,
                    stale: freshness.status === 'stale' || freshness.status === 'expired',
                    expired: freshness.status === 'expired',
                    available: !['unavailable', 'expired'].includes(freshness.status),
                    fetchedAt: freshness.fetchedAt,
                    snapshotId: sources[source]?.group === 'crm' ? lastGoodCrm?.snapshotId || null : lastGoodMarketing?.snapshotId || null,
                    warnings: freshness.lastError ? [freshness.lastError] : []
                }])),
                integrity: lastIntegrity && { checkedAt: lastIntegrity.checkedAt, ok: lastIntegrity.ok, issueCount: lastIntegrity.issues.length },
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
