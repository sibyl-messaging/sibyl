import type { Pool } from "pg";

import { HttpError } from "../utils/httpError.js";

export interface UserLookupResult {
  id: string;
  username: string;
  status: string;
  devices: Array<{
    id: string;
    x25519PublicKey: string;
  }>;
}

export class DirectoryService {
  constructor(private readonly pool: Pool) {}

  async lookupByUsername(username: string): Promise<UserLookupResult> {
    const normalized = username.trim().toLowerCase();

    const result = await this.pool.query<{
      id: string;
      username: string;
      status: string;
      frozen_at: Date | null;
    }>(
      `SELECT id, username, status, frozen_at
       FROM users
       WHERE username = $1`,
      [normalized]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "User not found");
    }

    const row = result.rows[0]!;
    if (row.frozen_at !== null || row.status !== "active") {
      throw new HttpError(403, "User is unavailable");
    }

    const devices = await this.pool.query<{
      id: string;
      x25519_public_key: string;
    }>(
      `SELECT id, x25519_public_key
       FROM devices
       WHERE user_id = $1`,
      [row.id]
    );

    return {
      id: row.id,
      username: row.username,
      status: row.status,
      devices: devices.rows.map((device) => ({
        id: device.id,
        x25519PublicKey: device.x25519_public_key
      }))
    };
  }

  async getDeviceSigningPublicKey(
    userId: string,
    deviceId: string
  ): Promise<string> {
    const result = await this.pool.query<{ signing_public_key: string }>(
      `SELECT signing_public_key
       FROM devices
       WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );
    if (!result.rowCount) {
      throw new HttpError(404, "Signing device not found");
    }
    return result.rows[0]!.signing_public_key;
  }
}
