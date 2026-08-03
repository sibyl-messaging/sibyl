# Sibyl Protocol v2 threat model

Status: working threat model for an experimental, unaudited prototype. This document describes intended properties and known gaps; it is not a security certification.

## Security goal

Protect the readable content of one short message when an attacker can observe or compromise a main messaging phone, provided the attacker does not also obtain every paper share needed for that message and does not defeat the helper-pair setup.

The design specifically addresses the endpoint problem: ordinary encrypted messaging eventually shows plaintext on a phone. Sibyl keeps plaintext and paper stamp values off the main-phone and relay interfaces.

## Protected assets

- The readable message written by Alice and recovered by Bob.
- Each 26-value paper share created by a borrowed-phone pair.
- The complete paper stamp bundle formed by all shares.
- Main-device authentication and signing keys.
- Temporary helper secrets while a share is being derived.

## What the main phones and relay may see

- Account, conversation, device, bundle, pair, and timing metadata.
- The number of helpers selected.
- Ephemeral helper public keys and an HPKE encapsulation.
- Public stamp labels and bundle lifecycle state.
- Signed A–Z ciphertext and its length.
- Delivery and acknowledgement state.

They are not intended to receive readable message text, derived stamp values, HPKE exporter secrets, or helper private keys.

## Security assumptions

Confidentiality currently depends on all of the following:

1. Alice and Bob never type, photograph, or display the readable message or paper stamp values on a networked device.
2. The paper remains private from cameras, bystanders, coercion, and physical theft.
3. Each complete stamp bundle is used for exactly one message and then destroyed or crossed out.
4. At least one required paper share remains unknown to the attacker.
5. Borrowed phones do not all collude with the attacker and do not retain recoverable helper secrets after setup.
6. The helper pairing is not successfully intercepted through relay or main-phone key substitution.
7. The implemented cryptographic libraries, browser runtime, randomness source, and canonical encodings behave as expected.

The user-selected helper count changes how many independent shares an attacker must collect. It does not repair a broken pairing protocol, compromised paper, or stamp reuse.

## Attacker cases

### Compromised main phone

The intended benefit is that spyware reading the main phone's screen, keyboard, storage, or network traffic sees ciphertext and public metadata, not plaintext. A compromised main phone can still block messages, lie about setup state, select or reorder participants, and interfere with helper attachment. Protocol v2 does not yet prove confidentiality against a fully malicious main phone during setup.

### Curious or compromised relay

The relay should not receive stamp values or plaintext. It can observe metadata, delay or block setup, refuse delivery, replay public state, and attempt key substitution. Base-mode HPKE alone does not authenticate the helper-to-helper transcript against a malicious relay. Mutual transcript authentication or an independently verified key-transparency mechanism remains a production blocker.

### Compromised borrowed phone

One helper handles one share, not the complete bundle. Compromising one of several independent helpers should reveal only that share. Compromising every required helper on one side, recording their screens, or recovering their transient secrets defeats the trust split.

### Paper compromise

Anyone who sees every paper share for a bundle and its ciphertext can recover the message. Sibyl does not protect against cameras, physical search, coercion, handwriting leakage, or failure to destroy used stamps.

### Reused stamp

Reusing a share or bundle exposes relationships between ciphertexts and can reveal plaintext structure. A bundle is consumed for one message even when fewer than 26 positions are used.

## Properties not provided

Sibyl does not currently promise:

- anonymity or concealment of who communicated;
- concealment of message timing or length;
- availability when the relay blocks traffic;
- deniability against signed-message records;
- protection from physical observation or coercion;
- protection after every helper or every paper share is compromised;
- production-grade authentication against a malicious relay;
- audited cryptographic correctness;
- support for arbitrary text beyond the versioned A–Z encoding.

## Required work before a production security claim

- Mutually authenticated helper transcripts or an equivalent independent verification path.
- Key transparency or another defense against relay key substitution.
- Secure storage and recovery rules for main-device signing keys.
- Rate limits and abuse controls for public registration and claim endpoints.
- Verification that helper secrets and displayed values are erased as intended across supported browsers.
- A documented deployment and logging policy.
- Independent protocol and implementation review.
