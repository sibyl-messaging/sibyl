# Sibyl relay

The relay coordinates accounts, conversations, temporary helper pairing, paper-stamp bundle state, signed ciphertext delivery, and acknowledgements.

> **Experimental and unaudited:** this service is not ready for production security claims.

## Protocol v2 data boundary

The relay stores or forwards public coordination metadata, ephemeral helper public keys, HPKE encapsulations, hashes of temporary capabilities and link codes, signed A–Z ciphertext, and delivery state.

Protocol v2 does not define any relay field for readable message text, derived paper values, exporter secrets, or helper private keys. Strict schemas reject undeclared message fields such as `plaintext`.

Older encrypted-envelope and queue routes remain for the legacy mobile experiment. See [`docs/legacy.md`](../../docs/legacy.md).

## Environment

Copy `.env.example` to `.env` and replace every placeholder.

Required:

- `DATABASE_URL`
- `JWT_SECRET` with at least 32 characters

Optional:

- `REDIS_URL` for the legacy ephemeral queue
- `HELPER_WEB_ORIGIN` for explicit browser-origin allowlisting
- `ACCESS_TOKEN_TTL_MIN`, default 15
- `REFRESH_TOKEN_TTL_DAYS`, default 30

## Run locally

From the repository root:

```sh
docker compose up -d
cp services/relay/.env.example services/relay/.env
npm run --workspace @sibyl/relay dev
```

## Deployment note

`vercel.relay.json` deploys the HTTP API for prototype testing. Full WebSocket behavior requires a long-running host. Do not treat a successful deployment as a security audit.
