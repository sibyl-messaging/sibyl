# Legacy experiments

Sibyl contains earlier prototypes that are preserved as research history but are not part of Paper Stamp Protocol v2.

## `apps/mobile`

The React Native client explores token streams, randomized numeric input, ghost rendering, calibration, and reconstructed seed material. Those ideas predate the paper-stamp design. They are unsupported and must not be used to infer Protocol v2 behavior or security properties.

The legacy mobile app is deliberately excluded from the root npm workspace, CI, dependency audit, and release build. Its dependency tree is not maintained.

## `apps/punchcard-web`

The standalone punch-card browser demo explores paper masks over screen patterns. It is not used by the current web application or relay protocol and is unsupported.

## Shared legacy routes and types

Some original encrypted-envelope, queue, grid, and token-stream code remains in `services/relay` and `packages/protocol` because the older applications still reference it. Current paper-stamp code lives under `packages/protocol/src/stamp`, the Protocol v2 relay routes, and `apps/helper-web`.

Legacy code should eventually move to an archived repository after the current implementation is stable. Until then, changes to legacy code must not be described as improvements to Protocol v2.
