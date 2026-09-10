import { ipInCidrs, normalizeAddress } from './cidr.js';

export function applyNetworkSecurity(app, config) {
    const trustedProxyCidrs = config.trustedProxyCidrs || [];
    const allowedClientCidrs = config.allowedClientCidrs || [];
    const enforce = Boolean(config.production);

    app.set('trust proxy', ip => trustedProxyCidrs.length > 0 && ipInCidrs(ip, trustedProxyCidrs));

    if (!enforce) return;

    app.use((req, res, next) => {
        const clientIp = normalizeAddress(req.ip || req.socket.remoteAddress);
        if (!ipInCidrs(clientIp, allowedClientCidrs)) {
            return res.status(403).json({
                error: 'Access denied',
                code: 'NETWORK_DENIED'
            });
        }
        return next();
    });
}
