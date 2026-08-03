# Sibyl Paper Stamp Protocol v2

Status: working, experimental Protocol v2 prototype. Protocol core, relay coordination, borrowed-phone helper flow, signed ciphertext delivery, and atomic one-use consumption are implemented. Helper-transcript authentication, key transparency, deployment hardening, and independent review remain open.

## What this proves

Sibyl can turn one high-entropy HPKE exporter secret shared by a temporary helper-device pair into 26 matching paper values. The relay and both main messaging phones coordinate public metadata but never receive those values. Alice writes plaintext only on paper and sends only wheel-produced A-Z ciphertext. Bob reverses the wheel steps on paper.

This core intentionally does not claim that the full system is secure yet. Helper authentication, key transparency, secure main-phone signing-key storage, and an external cryptographic review remain required. See the separate [threat model](threat-model.md) for attacker cases and assumptions.

## Setup flow

1. Alice requests a stamp bundle for Bob. Both main phones exchange only signed session metadata.
2. Alice and Bob must be online during setup, but they never need to meet.
3. For each share, Alice borrows one helper phone and Bob borrows one helper phone.
4. The two helpers establish an X25519 HPKE session. Its exporter secret is kept inside those helpers. Authentication against a malicious relay is still required before production.
5. Both helpers derive the same 26 values using the exact context below. Alice and Bob copy their matching values to paper.
6. With two shares, Alice has two paper stamp lines and Bob has the same two lines. The software records only that bundle metadata is `ready`.

Protocol v2 supports 2–10 shares. The current browser flow exposes that range and defaults to two. Increasing the count increases the number of shares an attacker must collect, but it also increases setup time and does not repair a compromised pairing protocol.

## Derivation

Inputs:

- at least 32 bytes of high-entropy exporter secret;
- protocol version;
- session ID;
- bundle ID;
- Alice's user ID;
- Bob's user ID;
- share index;
- bundle sequence number.

The context uses a fixed-order JSON array, not ordinary object serialization. HKDF-SHA256 produces 64-byte blocks. Each byte below 234 maps to `byte mod 26`; bytes 234-255 are discarded. Rejection is essential because 256 is not divisible by 26. More blocks are derived only if 26 accepted values have not yet been collected.

Fixed test vector:

```text
exporter secret: 00 01 02 ... 1f
session: session_test_001
bundle: bundle_test_001
sender: alice
recipient: bob
share index: 0
bundle sequence: 7
result: 13 09 06 17 02 16 14 08 11 14 07 21 04 09 09 17 21 05 21 16 17 19 24 14 12 06
```

## Paper wheel math

Letters are numbered A=0 through Z=25.

- To send: `cipher letter = (plain letter + stamp value) mod 26`.
- To read: `plain letter = (cipher letter - stamp value) mod 26`.
- For a bundle, Alice applies every share. Bob reverses every share.

Example vectors:

```text
HI + 03 01 = KJ
HELLO + 03 01 20 04 17 = KFFPF
KFFPF + 05 06 07 08 09 = PLMXO
```

Only uppercase A-Z is supported in this first proof. A message contains 1-26 letters. Spaces and punctuation require a later, explicitly versioned encoding rule.

## Ciphertext message

The signable message contains only public routing metadata and A-Z ciphertext:

- version, message ID, conversation ID, and bundle ID;
- sender and recipient user IDs;
- 1-26 ciphertext letters;
- creation time and sender signing-key ID.

Ed25519 signs a fixed-order canonical byte representation. Changing the recipient, bundle, ciphertext, or any other signed field breaks verification. Strict schemas reject undeclared fields such as `plaintext`.

## One-use rule

The permitted bundle states are:

```text
proposed -> pairing -> ready -> consumed
```

`proposed`, `pairing`, and `ready` may instead end as `expired` or `failed`. Terminal states cannot return to `ready`. The server implementation must make `ready -> consumed` atomic so two messages cannot race to use one bundle.

One whole bundle is consumed for one message even if the message is shorter than 26 letters. Reusing any share leaks relationships between the underlying plaintexts and is forbidden.

## Required work before production

- Standard HPKE helper sessions with mutual transcript authentication.
- Key transparency or an equivalent defense against relay key substitution.
- Secure-hardware storage for main-phone signing keys.
- Helper memory clearing, expiry, and interruption recovery.
- Rate limits, abuse controls, and a documented deployment and logging policy.
- Independent protocol and implementation audit.

## Relay coordination milestone

The relay now has a durable Protocol v2 coordination path. It stores bundle state, helper-pair state, ephemeral HPKE public keys, signed ciphertext, and delivery acknowledgements. It does not accept or store a stamp value or plaintext field.

Bundle setup is synchronous:

1. Alice creates a bundle while Bob has an authenticated live connection.
2. A borrowed phone manually opens the fixed helper page. It creates an ephemeral X25519 key pair locally, receives a private registration capability over TLS, and then shows a QR containing only a public registration ID. The capability remains in that browser's memory and is never placed in the QR.
3. The authenticated main phone scans that borrowed phone's QR and creates a pending claim for one of its own bundle slots. It displays a freshly generated six-digit physical link code. The scan direction is intentionally reversed: the main phone never displays a helper capability for another phone to claim.
4. The borrowed phone detects the pending claim but does not attach. The person types the six digits shown on the physically present main phone. Only the borrowed browser can approve because approval also requires its private capability. Competing photographed-QR claims remain inert without the matching physical code and capability.
5. The relay stores SHA-256 hashes of both the private registration capability and link code. Neither the QR nor main phone contains the private capability. A copied QR cannot poll, approve, publish, confirm, or derive a stamp.
6. After both registrations are approved and attached, Alice's initiating helper performs Base-mode X25519 HPKE and publishes the 32-byte encapsulation. Bob's helper receives the peer public key and encapsulation. Both export the same 32-byte secret, bound to a SHA-256 digest of the canonical bundle context, and independently derive the same 26 values.
7. Confirmation is blocked until the encapsulation exists. After each person confirms that the paper line was copied, the helper page drops its CryptoKey references, overwrites byte-array secrets and displayed values, and replaces them with a Done screen. The main phone advances only after that borrowed helper confirms completion. The bundle becomes ready only when every pair is confirmed at both ends.
8. The relay accepts a signed ciphertext message only if its bundle, conversation, sender, and recipient all match a non-expired ready bundle.
9. Acceptance uses one PostgreSQL transaction with `UPDATE ... WHERE state = 'ready'`. The winning request changes the state to consumed and inserts the ciphertext. A racing request cannot reuse the bundle.

The main mobile client now has a dedicated Prepare stamps screen. It defaults to two helpers, supports 2-10, scans public helper QRs with the native camera, creates pending claims, displays physical link codes, waits for paper-copy confirmation, and shows ready only after both people finish. The legacy Ceremony tab is hidden. The client deliberately has no method that receives the helper's private capability, exporter secret, or stamp values.

The borrowed-phone web page now performs the actual HPKE exporter operation and stamp derivation in browser memory. Automated tests prove that two independent helper sessions derive matching values and that changing the canonical bundle context changes the stamp. A real-browser pass verifies the public-QR, paper-copy, confirmation, and erased Done states on a 390×844 viewport.

The reversed QR plus physical code removes the simple “scan Bob's invitation first” completion attack: a photograph can create at most an unapproved pending claim. It does not solve final endpoint authentication. Base-mode HPKE alone cannot stop a malicious relay—or an actively compromised main phone controlling the attachment transcript—from substituting helper keys and creating separate sessions. Mutual transcript authentication, key transparency or an equivalent independent verification path, rate limiting for public registration and claim creation, and a credible way to enforce distinct helper devices are production blockers, not optional hardening. This prototype establishes secret isolation, usable paper output, and one-use delivery; it does not yet justify a production claim against a malicious relay or fully compromised main device.
