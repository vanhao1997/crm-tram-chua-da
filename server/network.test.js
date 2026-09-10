import test from 'node:test';
import assert from 'node:assert/strict';
import { ipInCidr, ipInCidrs } from './cidr.js';
import { loadConfig } from './config.js';

test('CIDR matching handles IPv4 and IPv6', () => {
    assert.equal(ipInCidr('10.42.1.5', '10.0.0.0/8'), true);
    assert.equal(ipInCidr('192.168.1.5', '10.0.0.0/8'), false);
    assert.equal(ipInCidr('::1', '::1'), true);
    assert.equal(ipInCidr('2001:db8::2', '2001:db8::/32'), true);
    assert.equal(ipInCidrs('192.168.1.5', ['10.0.0.0/8', '192.168.0.0/16']), true);
});

test('production configuration fails closed without explicit network allowlists', () => {
    assert.throws(
        () => loadConfig({
            NODE_ENV: 'production',
            GOOGLE_SERVICE_ACCOUNT_FILE: '/run/secrets/google-service-account.json'
        }),
        /ALLOWED_CLIENT_CIDRS is required/
    );
});
