import type { Pool } from "pg";

export type PushPlatform = "ios" | "android";

export class PushService {
  constructor(private readonly pool: Pool) {}

  async updatePushToken(
    deviceId: string,
    platform: PushPlatform,
    pushToken: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE devices
       SET push_platform = $2,
           push_token = $3
       WHERE id = $1`,
      [deviceId, platform, pushToken]
    );
  }

  async notifyNewGhostMessage(
    deviceId: string,
    conversationId: string
  ): Promise<void> {
    const target = await this.pool.query<{
      push_platform: string | null;
      push_token: string | null;
    }>(
      `SELECT push_platform, push_token
       FROM devices
       WHERE id = $1`,
      [deviceId]
    );

    if (!target.rowCount) {
      return;
    }

    const row = target.rows[0]!;
    if (!row.push_token || !row.push_platform) {
      return;
    }

    // Metadata-only notification payload; no plaintext or token content included.
    console.info("push.notify", {
      deviceId,
      platform: row.push_platform,
      conversationId,
      event: "new_ghost_message"
    });
  }
}
