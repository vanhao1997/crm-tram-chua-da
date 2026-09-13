const PII_KEYS = new Set(['name', 'phone', 'normalizedPhone', 'note', 'rawRows', 'url', 'spreadsheetId']);
const ACTIONS = new Set(['increase', 'hold', 'decrease', 'insufficient_data']);

export function validateAiInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid AI payload'), { code: 'AI_INVALID_INPUT', status: 400 });
  if (typeof body.periodKey !== 'string' || !body.periodKey.trim() || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    throw Object.assign(new Error('Invalid AI payload'), { code: 'AI_INVALID_INPUT', status: 400 });
  }
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > 65536) throw Object.assign(new Error('AI payload too large'), { code: 'AI_PAYLOAD_TOO_LARGE', status: 413 });
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (PII_KEYS.has(key) || /raw|customer|credential|token|secret/i.test(key)) throw Object.assign(new Error('AI payload contains restricted fields'), { code: 'AI_PII_REJECTED', status: 400 });
      walk(child);
    }
  };
  walk(body.payload || body);
  return body;
}

export function validateAiResponse(data) {
  if (!data || typeof data !== 'object' || !ACTIONS.has(data.action) || !['high', 'medium', 'low'].includes(data.confidence) || typeof data.summary !== 'string') return false;
  if (data.percent !== { increase: 10, hold: 0, decrease: -10, insufficient_data: null }[data.action]) return false;
  if (!Array.isArray(data.signals) || !Array.isArray(data.reasons) || !Array.isArray(data.checksBeforeChange) || !Array.isArray(data.dataLimitations) || !Array.isArray(data.nextSteps)) return false;
  const strings = values => values.every(v => typeof v === 'string' && v.length <= 3000);
  if (![data.reasons, data.checksBeforeChange, data.dataLimitations].every(strings)) return false;
  if (!data.nextSteps.every(step => step && typeof step.action === 'string' && typeof step.owner === 'string' && typeof step.deadline === 'string' && typeof step.reason === 'string')) return false;
  return data.signals.every(s => s && ['positive', 'negative', 'warning', 'info'].includes(s.type) && typeof s.title === 'string' && typeof s.impact === 'string' && Array.isArray(s.evidence) && strings(s.evidence));
}

export function normalizeAiResponse(data) {
  if (!data || typeof data !== 'object') return null;
  // Normalize labels only; never fabricate missing content or repair an unsafe percentage.
  const mappedAction = { tăng: 'increase', giảm: 'decrease', giữ: 'hold' }[data.action] || data.action;
  const mappedConfidence = { cao: 'high', 'trung bình': 'medium', thấp: 'low' }[data.confidence] || data.confidence;
  if (!validateAiResponse({ ...data, action: mappedAction, confidence: mappedConfidence })) return null;
  const action = { increase:'increase', hold:'hold', decrease:'decrease', insufficient_data:'insufficient_data', tăng:'increase', giảm:'decrease', giữ:'hold' }[String(data.action || '').trim().toLowerCase()] || 'insufficient_data';
  const confidence = { high:'high', medium:'medium', low:'low', cao:'high', 'trung bình':'medium', thấp:'low' }[String(data.confidence || '').trim().toLowerCase()] || 'low';
  return { summary: String(data.summary || data.recommendation || data.analysis || 'Chưa đủ dữ liệu để kết luận.'), action, percent: action === 'increase' ? 10 : action === 'decrease' ? -10 : action === 'hold' ? 0 : null, confidence,
    signals: Array.isArray(data.signals) ? data.signals.slice(0, 5).map(s => ({ type: ['positive','negative','warning','info'].includes(s?.type) ? s.type : 'info', title: String(s?.title || s?.name || 'Tín hiệu'), evidence: Array.isArray(s?.evidence) ? s.evidence.map(String) : [], impact: String(s?.impact || '') })) : [], nextSteps: Array.isArray(data.nextSteps) ? data.nextSteps.slice(0, 5).map(s => ({ action: String(s?.action || s?.title || 'Việc cần làm'), owner: String(s?.owner || ''), deadline: String(s?.deadline || ''), reason: String(s?.reason || '') })) : [], reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [], checksBeforeChange: Array.isArray(data.checksBeforeChange) ? data.checksBeforeChange.map(String) : [], dataLimitations: Array.isArray(data.dataLimitations) ? data.dataLimitations.map(String) : [], sourcePeriod: String(data.sourcePeriod || ''), generatedAt: String(data.generatedAt || new Date().toISOString()) };
}

function promptFor(payload) {
  return `Respond in Vietnamese. Analyze only the supplied aggregate metrics. Missing values are unknown, never zero.
Current metrics describe the active phase; CRM describes its explicitly stated date range. Do not compare different windows as equivalent.
Historical windows are matched day offsets from earlier months, not necessarily complete months. Cite the phase, month and supplied value for every quantitative claim. Discuss dispersion and conflicting months, not just the median. Do not infer recurring seasonality from fewer than three valid matched windows.
CRM event counts are not an attributed acquisition cohort. Do not add CRM revenue to Marketing revenue or infer causal conversion from unrelated event counts.
Respect deterministic recommendation, data quality, stale status and cutoff D-2. Never call actual spend approved budget. If deterministic action is insufficient_data, explain gaps and propose data verification steps only. Never suggest an increase or decrease in the narrative in that case.
Rank at most five nextSteps by urgency. Each must have action, owner (role, not a person's name), deadline (relative to review, without inventing calendar facts), and reason citing supplied evidence. Avoid generic suggestions unsupported by data. Distinguish hypotheses from observations; do not promise outcomes.
Return JSON only with keys summary, action, percent, confidence, signals, nextSteps, reasons, checksBeforeChange, dataLimitations, sourcePeriod, generatedAt. Signal keys: type (positive/negative/warning/info), title, evidence (array of strings), impact. Action must be increase/hold/decrease/insufficient_data; corresponding percent must be 10/0/-10/null. Confidence must be high/medium/low. reasons, checksBeforeChange and dataLimitations are arrays of strings.
Payload: ${JSON.stringify(payload)}`;
}

export async function analyzeMarketing({ payload, periodKey }, config, fetchImpl = fetch) {
  validateAiInput({ payload, periodKey });
  if (String(config.aiEnabled).toLowerCase() !== 'true' || !config.aiApiKey) throw Object.assign(new Error('AI is not configured'), { code: 'AI_NOT_CONFIGURED', status: 503 });
  const base = String(config.aiBaseUrl).replace(/\/$/, '');
  const body = JSON.stringify({ model: config.aiModel, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You are a cautious marketing analyst.' }, { role: 'user', content: promptFor(payload) }] });
  const deadline = Date.now() + Math.max(1000, Number(config.aiTimeoutMs) || 20_000);
  let response, responseController;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('AI provider timeout or network failure'), { code: 'AI_TIMEOUT', status: 504 });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), remaining);
    responseController = controller;
    try { response = await fetchImpl(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` }, body, signal: controller.signal }); }
    catch (error) { if (attempt === 1) throw Object.assign(new Error('AI provider timeout or network failure'), { code: 'AI_TIMEOUT', status: 504 }); continue; }
    finally { clearTimeout(timer); }
    if (response.ok) break;
    controller.abort();
    if (response.status === 429) throw Object.assign(new Error('AI rate limited'), { code: 'AI_RATE_LIMITED', status: 429 });
    if (response.status < 500) throw Object.assign(new Error('AI provider rejected request'), { code: 'AI_PROVIDER_ERROR', status: 502 });
    if (attempt === 1) throw Object.assign(new Error('AI provider unavailable'), { code: 'AI_PROVIDER_ERROR', status: 502 });
  }
  let parsed, bodyTimer;
  const timeoutError = Object.assign(new Error('AI provider timeout or network failure'), { code: 'AI_TIMEOUT', status: 504 });
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError;
    const responseTimer = new Promise((_, reject) => {
      bodyTimer = setTimeout(() => {
        reject(timeoutError);
        responseController.abort();
      }, remaining);
    });
    const json = await Promise.race([response.json(), responseTimer]);
    const content = json?.choices?.[0]?.message?.content;
    parsed = typeof content === 'object' ? content : JSON.parse(String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch (error) {
    responseController.abort();
    if (error === timeoutError) throw timeoutError;
    throw Object.assign(new Error('AI returned invalid JSON'), { code: 'AI_INVALID_RESPONSE', status: 502 });
  } finally {
    clearTimeout(bodyTimer);
  }
  parsed = normalizeAiResponse(parsed);
  if (!validateAiResponse(parsed)) throw Object.assign(new Error('AI returned invalid analysis schema'), { code: 'AI_INVALID_RESPONSE', status: 502 });
  const guard = payload?.guardrails || {};
  if (guard.deterministicAction === 'insufficient_data' || guard.stale === true || Number(guard.historicalSamples) < 3 || Number(guard.criticalWarnings) > 0) {
    if (parsed.action === 'increase' || parsed.action === 'decrease') {
      throw Object.assign(new Error('AI recommendation conflicts with data quality constraints'), { code: 'AI_INVALID_RESPONSE', status: 502 });
    }
    parsed.action = 'insufficient_data'; parsed.percent = null;
    parsed.warnings = [...(parsed.warnings || []), 'Deterministic guardrail prevents budget adjustment.'];
  }
  return parsed;
}
