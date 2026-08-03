# Sibyl

Sibyl is an experimental messaging system where readable messages stay on paper. Phones and the relay carry only scrambled letters and public coordination data.

> **Security status:** research prototype, Protocol v2. Sibyl has not received an independent security audit. Do not use it for real secrets or personal safety.

Try the current web prototype at [sibyl-stamps.vercel.app](https://sibyl-stamps.vercel.app).

## Why it exists

Normal encrypted messaging protects a message while it travels, but the readable text still appears on the sender's and recipient's phones. Malware that can watch a keyboard or screen can bypass the transport encryption entirely.

Sibyl explores a different boundary: people write and read the real message on paper. They use a printable paper wheel and one-use paper stamps to convert between readable text and A–Z ciphertext. The main phones never need the plaintext or stamp values.

## How Protocol v2 works

1. Alice and Bob start a one-to-one conversation online.
2. Each person borrows at least two separate nearby phones during stamp setup.
3. Each Alice-side helper is paired remotely with one Bob-side helper. A helper pair derives the same 26 random paper values locally.
4. Alice and Bob copy their matching values to paper. The relay receives public setup metadata, ephemeral public keys, and an HPKE encapsulation, but not the derived values.
5. Alice writes a message of up to 26 A–Z letters on paper and uses every paper share plus the wheel to produce ciphertext.
6. Alice types only the ciphertext into her phone. Bob copies that ciphertext from his phone and reverses the wheel steps on paper.
7. Both people cross out the complete stamp bundle. It must never be reused.

The current helper protocol uses X25519 HPKE, HKDF-SHA256, rejection sampling for uniform values from 0–25, and Ed25519 signatures for ciphertext messages. See [the Protocol v2 specification](docs/protocol-v2.md) and [threat model](docs/threat-model.md).

## What is current

| Path | Status | Purpose |
| --- | --- | --- |
| `apps/helper-web` | Current prototype | Main-phone and borrowed-phone browser flows |
| `packages/protocol/src/stamp` | Current protocol | Paper-share derivation, lifecycle rules, signatures, and wheel math |
| `services/relay` | Current, with legacy routes | Authentication, pairing coordination, bundle state, and ciphertext delivery |
| `scripts/generate_paper_cipher_wheel.py` | Current asset source | Generates the printable paper wheel |
| `apps/mobile` | Legacy experiment | Earlier token/grid and ghost-rendering approach; not Protocol v2 |
| `apps/punchcard-web` | Legacy experiment | Earlier punch-card browser demo; not Protocol v2 |

Legacy code remains for research history and is not part of the current security claim. See [Legacy experiments](docs/legacy.md).

## Run locally

Requirements: Node.js 22.12 or newer, npm, Docker, and Docker Compose.

```sh
npm install
docker compose up -d
cp services/relay/.env.example services/relay/.env
npm run --workspace @sibyl/relay dev
```

In a second terminal:

```sh
npm run --workspace @sibyl/helper-web dev
```

Open `http://localhost:4173`. The helper web app proxies Protocol v2 requests to the local relay on port 8080.

## Verify

```sh
npm run test
npm run typecheck
```

Protocol v2 test vectors live in `packages/protocol/test/stampProtocolV2.test.ts`. Relay state and one-use behavior are covered in `services/relay/test/stampService.test.ts`.

## Security and contributions

- Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing protocol changes.
- Never submit real messages, stamp values, credentials, or private keys in an issue or test fixture.

## License

Code and documentation are licensed under the [GNU Affero General Public License v3.0](LICENSE). The Sibyl name and visual identity are not granted for use by that license; see [TRADEMARKS.md](TRADEMARKS.md).
