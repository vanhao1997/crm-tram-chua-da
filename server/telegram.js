import https from 'node:https';

export function telegramRequest(token, method, body, request = https.request) {
    return new Promise((resolve, reject) => {
        const req = request({ hostname: 'api.telegram.org', path: '/bot' + token + '/' + method,
            method: 'POST', family: 4, headers: { 'content-type': 'application/json' } }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { data += chunk; });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, payload: JSON.parse(data) }); }
                catch { reject(new Error('TELEGRAM_INVALID_RESPONSE')); }
            });
        });
        req.setTimeout(15000, () => req.destroy(new Error('TELEGRAM_TIMEOUT')));
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}
