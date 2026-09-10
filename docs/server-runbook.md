# BSN API runtime runbook

The app reads Google Sheets through the server with the service account's read-only scope. The credential file is never bundled into `dist`, the Docker image, or the browser bundle.

## Local

Keep the JSON key outside the repository:

```text
C:\bsn-secrets\google-service-account.json
```

Copy `.env.example` to `.env.local`, adjust the credential path, then run:

```bash
npm run api
npm run dev
```

The API binds to `127.0.0.1:3001`. Vite proxies `/api` to it. The frontend should call only:

```text
GET /api/sheets?source=leads
GET /api/sheets?source=booked
GET /api/sheets?source=arrived
GET /api/sheets?source=marketing
```

`id` and `range` query parameters are rejected. The server resolves each source to the fixed Sheet IDs and tab names from environment variables.

## Production / Coolify

Use the Dockerfile runtime. It serves `dist` and `/api` from one Node process on port `3000`. Mount the service account as a runtime secret, for example:

```text
/run/secrets/google-service-account.json
```

Required production variables:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
GOOGLE_SERVICE_ACCOUNT_FILE=/run/secrets/google-service-account.json
TRUSTED_PROXY_CIDRS=<reverse-proxy CIDR>
ALLOWED_CLIENT_CIDRS=<VPN/internal CIDR>
```

The process fails closed if the credential, static build, or either network allowlist is missing. The reverse proxy is the only public-facing layer. Configure Coolify to expose port `3000` for this runtime and keep the upstream Node port private.

`TRUSTED_PROXY_CIDRS` controls which proxy addresses may supply forwarded client IP headers. `ALLOWED_CLIENT_CIDRS` controls which resolved client addresses may use the app. Do not set either to `0.0.0.0/0` for an internal-only deployment.

## Health and incident checks

```text
GET /api/health/live
GET /api/health/ready
GET /api/health
```

`live` only proves the process is running. `ready` reports server configuration and the last successful Sheet fetch; it does not replace a source read. On a refresh failure after a successful read, the API serves the previous complete snapshot with `metadata.stale: true` and no customer data in logs.

## Tests

```bash
node --test server/*.test.js
npm run build
```

Tests use an injected fake Sheets client. They cover the source allowlist, atomic CRM reads, in-flight deduplication, cache, retry behavior, permission failures, stale fallback, health endpoints, CIDR checks, and production network rejection.
