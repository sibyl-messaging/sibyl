# Contributing to Sibyl

Sibyl handles security-sensitive protocol code. Small, reviewable changes with explicit tests are preferred.

## Before changing the protocol

1. Read [docs/protocol-v2.md](docs/protocol-v2.md) and [docs/threat-model.md](docs/threat-model.md).
2. Open an issue describing the security property, user problem, and compatibility impact.
3. Do not silently change canonical encodings, derivation domains, lifecycle transitions, or paper-wheel rules. Such changes require a new protocol version and test vectors.

## Pull requests

- Keep the change narrowly scoped.
- Add or update executable tests.
- Run `npm run test` and `npm run typecheck`.
- Update the protocol or threat-model documents when behavior or assumptions change.
- Do not add real credentials, private keys, messages, paper stamps, analytics exports, or user data.
- Describe what the change proves and what it does not prove.

Security reports belong in the private process described in [SECURITY.md](SECURITY.md), not in a normal pull request or public issue.

By contributing, you agree that your contribution is licensed under AGPL-3.0.
