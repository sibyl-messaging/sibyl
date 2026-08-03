import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { x25519 } from "@noble/curves/ed25519";
import {
  createTokenStream,
  decryptTokenStreamEnvelope,
  encryptTokenStreamEnvelope
} from "@sibyl/protocol/node";
import nacl from "tweetnacl";
import WebSocket from "ws";

const RELAY_URL = process.env.RELAY_URL ?? "http://127.0.0.1:8080";

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(input) {
  return Uint8Array.from(Buffer.from(input, "base64"));
}

async function post(path, body, token) {
  const response = await fetch(`${RELAY_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`POST ${path} failed (${response.status}): ${text}`);
  }

  return payload;
}

async function registerAndAuthenticate(username) {
  const signing = nacl.sign.keyPair();
  const xPriv = x25519.utils.randomPrivateKey();
  const xPub = x25519.getPublicKey(xPriv);

  const deviceId = `dev_${randomUUID()}`;

  await post("/v1/users/register", {
    username,
    deviceId,
    signingPublicKey: toBase64(signing.publicKey),
    x25519PublicKey: toBase64(xPub)
  });

  const challenge = await post("/v1/auth/challenge", {
    username,
    deviceId
  });

  const nonce = fromBase64(challenge.nonce);
  const signature = nacl.sign.detached(nonce, signing.secretKey);

  const verified = await post("/v1/auth/verify", {
    challengeId: challenge.challengeId,
    signature: toBase64(signature)
  });

  return {
    username,
    deviceId,
    accessToken: verified.accessToken,
    userId: verified.auth.userId,
    x25519PublicKey: toBase64(xPub),
    x25519PrivateKey: toBase64(xPriv)
  };
}

class WsClient {
  constructor(token, name) {
    this.name = name;
    this.frames = [];
    this.waiters = [];
    this.ws = new WebSocket(`${RELAY_URL.replace(/^http/, "ws")}/ws?accessToken=${encodeURIComponent(token)}`);
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[${this.name}] ws open timeout`));
      }, 8000);

      this.ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });

      this.ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    this.ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      this.frames.push(frame);
      this.drainWaiters();
    });

    this.send("queue.sync", {});
  }

  send(event, data) {
    this.ws.send(JSON.stringify({ event, data }));
  }

  async waitFor(event, predicate = () => true, timeoutMs = 8000) {
    const existing = this.frames.find((frame) => frame.event === event && predicate(frame.data));
    if (existing) {
      return existing.data;
    }

    return new Promise((resolve, reject) => {
      const expiresAt = Date.now() + timeoutMs;
      this.waiters.push({ event, predicate, resolve, reject, expiresAt });
      this.drainWaiters();
    });
  }

  drainWaiters() {
    const now = Date.now();
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.expiresAt <= now) {
        waiter.reject(new Error(`[${this.name}] timeout waiting for ${waiter.event}`));
        return false;
      }

      const frame = this.frames.find(
        (candidate) => candidate.event === waiter.event && waiter.predicate(candidate.data)
      );

      if (!frame) {
        return true;
      }

      waiter.resolve(frame.data);
      return false;
    });
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const userA = await registerAndAuthenticate(`alice_${suffix}`);
  const userB = await registerAndAuthenticate(`bob_${suffix}`);

  const wsA = new WsClient(userA.accessToken, "A");
  const wsB = new WsClient(userB.accessToken, "B");

  await wsA.open();
  await wsB.open();

  const created = await post(
    "/v1/conversations",
    { recipientUsername: userB.username },
    userA.accessToken
  );
  assert.ok(created.conversationId, "conversation id required");

  const invite = await wsB.waitFor(
    "conversation.invite",
    (data) => data.conversationId === created.conversationId
  );
  assert.equal(invite.fromUsername, userA.username);

  wsB.send("conversation.accept", {
    conversationId: created.conversationId
  });

  const acceptedA = await wsA.waitFor(
    "conversation.accept",
    (data) => data.conversationId === created.conversationId
  );
  assert.equal(acceptedA.status, "active");

  const tokenStream = createTokenStream({
    conversationId: created.conversationId,
    tokens: [4, 7, 11, 22]
  });

  const envelope = encryptTokenStreamEnvelope({
    conversationId: created.conversationId,
    senderDeviceId: userA.deviceId,
    tokenStream,
    recipientStaticPublicKey: fromBase64(userB.x25519PublicKey)
  });

  wsA.send("message.envelope", envelope);

  const receivedEnvelope = await wsB.waitFor(
    "message.envelope",
    (data) => data.envelopeId === envelope.envelopeId
  );

  const decrypted = decryptTokenStreamEnvelope({
    recipientStaticPrivateKey: fromBase64(userB.x25519PrivateKey),
    envelope: receivedEnvelope
  });

  assert.deepEqual(decrypted.tokens, tokenStream.tokens);
  assert.equal(decrypted.conversationId, tokenStream.conversationId);

  wsB.send("message.ack", {
    envelopeId: envelope.envelopeId
  });

  const senderAck = await wsA.waitFor(
    "message.ack",
    (data) => data.envelopeId === envelope.envelopeId
  );

  assert.equal(senderAck.status, "queued");

  wsA.close();
  wsB.close();

  console.log("E2E relay flow passed", {
    conversationId: created.conversationId,
    envelopeId: envelope.envelopeId,
    sender: userA.username,
    recipient: userB.username
  });
}

main().catch((error) => {
  console.error("E2E relay flow failed", error);
  process.exit(1);
});
