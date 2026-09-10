import net from 'node:net';

function normalizeIpv4(value) {
    const parts = String(value).split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return null;
    const octets = parts.map(Number);
    if (octets.some(part => part < 0 || part > 255)) return null;
    return octets;
}

function ipv4ToNumber(octets) {
    return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function normalizeIp(value) {
    if (!value) return '';
    let ip = String(value).trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return ip;
}

function ipv6Words(value) {
    const ip = normalizeIp(value).toLowerCase();
    if (net.isIP(ip) !== 6) return null;
    const [leftRaw, rightRaw = ''] = ip.split('::');
    const left = leftRaw ? leftRaw.split(':').filter(Boolean) : [];
    const right = rightRaw ? rightRaw.split(':').filter(Boolean) : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8) return null;
    const words = groups.map(group => Number.parseInt(group, 16));
    return words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

function parseCidr(cidr) {
    const [rawAddress, rawPrefix] = String(cidr).trim().split('/');
    const address = normalizeIp(rawAddress);
    const version = net.isIP(address);
    if (!version) return null;
    const maxPrefix = version === 4 ? 32 : 128;
    const prefix = rawPrefix === undefined || rawPrefix === '' ? maxPrefix : Number(rawPrefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;

    if (version === 4) {
        const octets = normalizeIpv4(address);
        return octets ? { version, prefix, number: ipv4ToNumber(octets) } : null;
    }
    const words = ipv6Words(address);
    return words ? { version, prefix, words } : null;
}

export function ipInCidr(ip, cidr) {
    const normalizedIp = normalizeIp(ip);
    const parsedCidr = parseCidr(cidr);
    const ipVersion = net.isIP(normalizedIp);
    if (!parsedCidr || ipVersion !== parsedCidr.version) return false;

    if (ipVersion === 4) {
        const ipNumber = ipv4ToNumber(normalizeIpv4(normalizedIp));
        if (parsedCidr.prefix === 0) return true;
        const mask = (0xffffffff << (32 - parsedCidr.prefix)) >>> 0;
        return (ipNumber & mask) === (parsedCidr.number & mask);
    }

    const words = ipv6Words(normalizedIp);
    let remaining = parsedCidr.prefix;
    for (let index = 0; index < 8 && remaining > 0; index += 1) {
        const bits = Math.min(remaining, 16);
        const mask = bits === 16 ? 0xffff : ((0xffff << (16 - bits)) & 0xffff);
        if ((words[index] & mask) !== (parsedCidr.words[index] & mask)) return false;
        remaining -= bits;
    }
    return true;
}

export function ipInCidrs(ip, cidrs = []) {
    return cidrs.some(cidr => ipInCidr(ip, cidr));
}

export function normalizeAddress(value) {
    return normalizeIp(value);
}
