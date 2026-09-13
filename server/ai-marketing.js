const PII_KEYS = new Set(['name', 'phone', 'normalizedPhone', 'note', 'rawRows', 'url', 'spreadsheetId']);
const ACTIONS = new Set(['increase', 'hold', 'decrease', 'insufficient_data']);

export function validateAiInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid AI payload'), { code: 'AI_INVALID_INPUT', status: 400 });
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
  if (data.percent !== null && ![10, 0, -10].includes(data.percent)) return false;
  if (!Array.isArray(data.signals) || !Array.isArray(data.reasons) || !Array.isArray(data.checksBeforeChange) || !Array.isArray(data.dataLimitations)) return false;
  if (data.action === 'insufficient_data' && data.percent !== null) return false;
  return data.signals.every(s => s && ['positive', 'negative', 'warning', 'info'].includes(s.type) && typeof s.title === 'string' && Array.isArray(s.evidence));
}

export function normalizeAiResponse(data) {
  if (!data || typeof data !== 'object') return null;
  const action = { increase:'increase', hold:'hold', decrease:'decrease', insufficient_data:'insufficient_data', tăng:'increase', giảm:'decrease', giữ:'hold' }[String(data.action || '').trim().toLowerCase()] || 'insufficient_data';
  const confidence = { high:'high', medium:'medium', low:'low', cao:'high', 'trung bình':'medium', thấp:'low' }[String(data.confidence || '').trim().toLowerCase()] || 'low';
  return { summary: String(data.summary || data.recommendation || data.analysis || 'Chưa đủ dữ liệu để kết luận.'), action, percent: action === 'increase' ? 10 : action === 'decrease' ? -10 : action === 'hold' ? 0 : null, confidence,
    signals: Array.isArray(data.signals) ? data.signals.slice(0, 5).map(s => ({ type: ['positive','negative','warning','info'].includes(s?.type) ? s.type : 'info', title: String(s?.title || s?.name || 'Tín hiệu'), evidence: Array.isArray(s?.evidence) ? s.evidence.map(String) : [], impact: String(s?.impact || '') })) : [], nextSteps: Array.isArray(data.nextSteps) ? data.nextSteps.slice(0, 5).map(s => ({ action: String(s?.action || s?.title || 'Việc cần làm'), owner: String(s?.owner || ''), deadline: String(s?.deadline || ''), reason: String(s?.reason || '') })) : [], reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [], checksBeforeChange: Array.isArray(data.checksBeforeChange) ? data.checksBeforeChange.map(String) : [], dataLimitations: Array.isArray(data.dataLimitations) ? data.dataLimitations.map(String) : [], sourcePeriod: String(data.sourcePeriod || ''), generatedAt: String(data.generatedAt || new Date().toISOString()) };
}

function promptFor(payload) {
  return `Analyze aggregate marketing and CRM metrics only. Never invent missing values or call actual spend approved budget. Respect deterministic recommendation and cutoff D-2. Return JSON only with keys summary, action, percent, confidence, signals, nextSteps, reasons, checksBeforeChange, dataLimitations, sourcePeriod, generatedAt. Provide at most 5 concrete nextSteps with owner/action/deadline/reason. Action must be increase/hold/decrease/insufficient_data; percent only 10,0,-10,null. Payload: ${JSON.stringify(payload)}`;
}

export async function analyzeMarketing({ payload, periodKey }, config, fetchImpl = fetch) {
  validateAiInput({ payload, periodKey });
  if (String(config.aiEnabled).toLowerCase() !== 'true' || !config.aiApiKey) throw Object.assign(new Error('AI is not configured'), { code: 'AI_NOT_CONFIGURED', status: 503 });
  const base = String(config.aiBaseUrl).replace(/\/$/, '');
  const body = JSON.stringify({ model: config.aiModel, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You are a cautious marketing analyst.' }, { role: 'user', content: promptFor(payload) }] });
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.aiTimeoutMs);
    try { response = await fetchImpl(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` }, body, signal: controller.signal }); }
    catch (error) { if (attempt === 1) throw Object.assign(new Error('AI provider timeout or network failure'), { code: 'AI_TIMEOUT', status: 504 }); continue; }
    finally { clearTimeout(timer); }
    if (response.ok) break;
    if (response.status === 429) throw Object.assign(new Error('AI rate limited'), { code: 'AI_RATE_LIMITED', status: 429 });
    if (response.status < 500) throw Object.assign(new Error('AI provider rejected request'), { code: 'AI_PROVIDER_ERROR', status: 502 });
    if (attempt === 1) throw Object.assign(new Error('AI provider unavailable'), { code: 'AI_PROVIDER_ERROR', status: 502 });
  }
  let parsed; try { const json = await response.json(); const content = json?.choices?.[0]?.message?.content; parsed = typeof content === 'object' ? content : JSON.parse(String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw Object.assign(new Error('AI returned invalid JSON'), { code: 'AI_INVALID_RESPONSE', status: 502 }); }
  parsed = normalizeAiResponse(parsed);
  if (!validateAiResponse(parsed)) throw Object.assign(new Error('AI returned invalid analysis schema'), { code: 'AI_INVALID_RESPONSE', status: 502 });
  const guard = payload?.guardrails || {};
  if (guard.deterministicAction === 'insufficient_data' || guard.stale === true || Number(guard.historicalSamples) < 3 || Number(guard.criticalWarnings) > 0) {
    parsed.action = 'insufficient_data'; parsed.percent = null;
    parsed.warnings = [...(parsed.warnings || []), 'Deterministic guardrail prevents budget adjustment.'];
  }
  return parsed;
}
