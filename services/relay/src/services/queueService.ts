import type { Redis } from "ioredis";
import type { Pool } from "pg";

import type { EncryptedEnvelope } from "../protocol/envelope.js";

import { nextId } from "../utils/ids.js";

const QUEUE_TTL_SEC = 86_400;

export interface QueueServiceLike {
  enqueueForDevice(
    recipientDeviceId: string,
    senderDeviceId: string,
    envelope: EncryptedEnvelope
  ): Promise<void>;
  getPendingForDevice(recipientDeviceId: string): Promise<EncryptedEnvelope[]>;
  acknowledge(recipientDeviceId: string, envelopeId: string): Promise<void>;
  markDelivered(recipientDeviceId: string, envelopeId: string): Promise<void>;
}

export class QueueService implements QueueServiceLike {
  constructor(
    private readonly redis: Redis,
    private readonly pool: Pool
  ) {}

  async enqueueForDevice(
    recipientDeviceId: string,
    senderDeviceId: string,
    envelope: EncryptedEnvelope
  ): Promise<void> {
    const envelopeKey = this.envelopeKey(envelope.envelopeId);
    const queueKey = this.queueKey(recipientDeviceId);
    const expiresAt = Date.now() + QUEUE_TTL_SEC * 1000;

    const tx = this.redis.multi();
    tx.set(envelopeKey, JSON.stringify(envelope), "EX", QUEUE_TTL_SEC);
    tx.zadd(queueKey, expiresAt, envelope.envelopeId);
    tx.expire(queueKey, QUEUE_TTL_SEC);
    await tx.exec();

    await this.pool.query(
      `INSERT INTO delivery_audit (
         id,
         conversation_id,
         envelope_id,
         sender_device_id,
         recipient_device_id
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        nextId("dla"),
        envelope.conversationId,
        envelope.envelopeId,
        senderDeviceId,
        recipientDeviceId
      ]
    );
  }

  async getPendingForDevice(
    recipientDeviceId: string
  ): Promise<EncryptedEnvelope[]> {
    const queueKey = this.queueKey(recipientDeviceId);
    const envelopeIds = await this.redis.zrange(queueKey, 0, -1);

    const pending: EncryptedEnvelope[] = [];
    for (const envelopeId of envelopeIds) {
      const payload = await this.redis.get(this.envelopeKey(envelopeId));
      if (payload === null) {
        await this.redis.zrem(queueKey, envelopeId);
        continue;
      }

      pending.push(JSON.parse(payload) as EncryptedEnvelope);
    }

    return pending;
  }

  async acknowledge(
    recipientDeviceId: string,
    envelopeId: string
  ): Promise<void> {
    await this.redis.zrem(this.queueKey(recipientDeviceId), envelopeId);

    await this.pool.query(
      `UPDATE delivery_audit
       SET acked_at = NOW(),
           delivered_at = COALESCE(delivered_at, NOW())
       WHERE envelope_id = $1
         AND recipient_device_id = $2`,
      [envelopeId, recipientDeviceId]
    );
  }

  async markDelivered(
    recipientDeviceId: string,
    envelopeId: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE delivery_audit
       SET delivered_at = COALESCE(delivered_at, NOW())
       WHERE envelope_id = $1
         AND recipient_device_id = $2`,
      [envelopeId, recipientDeviceId]
    );
  }

  private queueKey(deviceId: string): string {
    return `queue:${deviceId}`;
  }

  private envelopeKey(envelopeId: string): string {
    return `envelope:${envelopeId}`;
  }
}
