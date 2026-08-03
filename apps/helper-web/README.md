# Sibyl paper-stamp web prototype

This is the current Protocol v2 browser application. It contains the main-phone test flow, borrowed-phone helper flow, onboarding, security explanation, and printable paper wheels.

> **Experimental and unaudited:** do not use this prototype for real secrets or personal safety.

A borrowed phone creates an ephemeral X25519 key locally, shows a public-only QR to the main phone, derives one 26-number paper share with its remote partner, and drops its in-memory secret references after the values are copied.

For local development, run the relay on port 8080, then:

```sh
npm run --workspace @sibyl/helper-web dev
```

The Vite server proxies `/v2` to the local relay. In production, set `VITE_RELAY_URL` on this app and set the same app origin in the relay's `HELPER_WEB_ORIGIN`. Multiple allowed origins may be comma-separated.

Read the repository [security policy](../../SECURITY.md), [Protocol v2 specification](../../docs/protocol-v2.md), and [threat model](../../docs/threat-model.md) before changing the security flow.
