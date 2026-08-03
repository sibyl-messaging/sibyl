import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import type { Pool } from "pg";
import nacl from "tweetnacl";

import type { Env } from "../config/env.js";
import type { AuthContext, RegisterUserInput } from "../types/domain.js";
import { nextId } from "../utils/ids.js";
import { HttpError } from "../utils/httpError.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export interface AuthChallengeResult {
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

export interface VerifyChallengeInput {
  challengeId: string;
  signature: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  auth: AuthContext;
}

export class AuthService {
  private readonly jwtSecret: Uint8Array;

  constructor(
    private readonly pool: Pool,
    private readonly env: Env
  ) {
    this.jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
  }

  async registerUser(input: RegisterUserInput): Promise<{ userId: string }> {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw new HttpError(400, "Username must match /^[a-z0-9_]{3,24}$/");
    }

    const signingKeyBytes = decodeBase64(input.signingPublicKey, "signingPublicKey");
    const x25519KeyBytes = decodeBase64(input.x25519PublicKey, "x25519PublicKey");

    if (signingKeyBytes.length !== nacl.sign.publicKeyLength) {
      throw new HttpError(400, "Invalid signingPublicKey length");
    }

    if (x25519KeyBytes.length !== 32) {
      throw new HttpError(400, "Invalid x25519PublicKey length");
    }

    const userId = nextId("usr");
    const deviceId = input.deviceId.trim();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string; frozen_at: Date | null }>(
        "SELECT id, frozen_at FROM users WHERE username = $1",
        [username]
      );

      if (existing.rowCount && existing.rowCount > 0) {
        const row = existing.rows[0]!;
        if (row.frozen_at !== null) {
          throw new HttpError(
            403,
            "Username is permanently frozen due to unrecoverable key loss"
          );
        }

        throw new HttpError(409, "Username already exists");
      }

      await client.query(
        `INSERT INTO users (id, username, status)
         VALUES ($1, $2, 'active')`,
        [userId, username]
      );

      await client.query(
        `INSERT INTO devices (id, user_id, signing_public_key, x25519_public_key)
         VALUES ($1, $2, $3, $4)`,
        [deviceId, userId, input.signingPublicKey, input.x25519PublicKey]
      );

      await client.query("COMMIT");
      return { userId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createChallenge(
    username: string,
    deviceId: string
  ): Promise<AuthChallengeResult> {
    const normalized = username.trim().toLowerCase();

    const device = await this.pool.query<{
      device_id: string;
      user_id: string;
      username: string;
      status: string;
      frozen_at: Date | null;
    }>(
      `SELECT d.id AS device_id, u.id AS user_id, u.username, u.status, u.frozen_at
       FROM devices d
       JOIN users u ON u.id = d.user_id
       WHERE u.username = $1 AND d.id = $2`,
      [normalized, deviceId]
    );

    if (!device.rowCount) {
      throw new HttpError(404, "Device not found for username");
    }

    const row = device.rows[0]!;
    if (row.frozen_at !== null || row.status !== "active") {
      throw new HttpError(403, "User is not eligible for login");
    }

    const challengeId = nextId("chl");
    const nonce = randomBytes(32).toString("base64");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    await this.pool.query(
      `INSERT INTO auth_challenges (id, device_id, nonce, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [challengeId, deviceId, nonce, expiresAt.toISOString()]
    );

    return {
      challengeId,
      nonce,
      expiresAt: expiresAt.toISOString()
    };
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<TokenPair> {
    const challenge = await this.pool.query<{
      challenge_id: string;
      nonce: string;
      expires_at: Date;
      consumed_at: Date | null;
      device_id: string;
      user_id: string;
      username: string;
      signing_public_key: string;
    }>(
      `SELECT c.id AS challenge_id,
              c.nonce,
              c.expires_at,
              c.consumed_at,
              d.id AS device_id,
              u.id AS user_id,
              u.username,
              d.signing_public_key
       FROM auth_challenges c
       JOIN devices d ON d.id = c.device_id
       JOIN users u ON u.id = d.user_id
       WHERE c.id = $1`,
      [input.challengeId]
    );

    if (!challenge.rowCount) {
      throw new HttpError(404, "Challenge not found");
    }

    const row = challenge.rows[0]!;
    if (row.consumed_at !== null) {
      throw new HttpError(409, "Challenge already consumed");
    }

    if (row.expires_at.getTime() < Date.now()) {
      throw new HttpError(401, "Challenge expired");
    }

    const signature = decodeBase64(input.signature, "signature");
    if (signature.length !== nacl.sign.signatureLength) {
      throw new HttpError(400, "Invalid signature length");
    }

    const nonce = decodeBase64(row.nonce, "nonce");
    const publicKey = decodeBase64(row.signing_public_key, "signing_public_key");

    const verified = nacl.sign.detached.verify(nonce, signature, publicKey);
    if (!verified) {
      throw new HttpError(401, "Invalid challenge signature");
    }

    await this.pool.query(
      "UPDATE auth_challenges SET consumed_at = NOW() WHERE id = $1",
      [row.challenge_id]
    );

    const auth: AuthContext = {
      userId: row.user_id,
      username: row.username,
      deviceId: row.device_id
    };

    const accessToken = await new SignJWT({
      username: row.username,
      deviceId: row.device_id,
      typ: "access"
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(row.user_id)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_MIN}m`)
      .sign(this.jwtSecret);

    const refreshToken = await new SignJWT({
      username: row.username,
      deviceId: row.device_id,
      typ: "refresh"
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(row.user_id)
      .setIssuedAt()
      .setExpirationTime(`${this.env.REFRESH_TOKEN_TTL_DAYS}d`)
      .sign(this.jwtSecret);

    await this.pool.query(
      `INSERT INTO refresh_tokens (id, device_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)`,
      [
        nextId("rft"),
        row.device_id,
        createHash("sha256").update(refreshToken).digest("hex"),
        String(this.env.REFRESH_TOKEN_TTL_DAYS)
      ]
    );

    return {
      accessToken,
      refreshToken,
      expiresInSec: this.env.ACCESS_TOKEN_TTL_MIN * 60,
      auth
    };
  }

  async verifyAccessToken(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        algorithms: ["HS256"]
      });

      if (payload.typ !== "access") {
        throw new HttpError(401, "Invalid token type");
      }

      const userId = payload.sub;
      const username = payload.username;
      const deviceId = payload.deviceId;

      if (
        typeof userId !== "string" ||
        typeof username !== "string" ||
        typeof deviceId !== "string"
      ) {
        throw new HttpError(401, "Malformed access token");
      }

      return { userId, username, deviceId };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(401, "Invalid access token");
    }
  }
}

function decodeBase64(value: string, field: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    throw new HttpError(400, `Invalid base64 for ${field}`);
  }
}
