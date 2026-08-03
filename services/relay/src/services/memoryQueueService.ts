import type { Pool } from "pg";

import type { EncryptedEnvelope } from "../protocol/envelope.js";

import { nextId } from "../utils/ids.js";
import type { QueueServiceLike } from "./queueService.js";

const QUEUE_TTL_MS = 86_400_000;

interface QueueEntry {
  envelope: EncryptedEnvelope;
  expiresAtMs: number;
}

export class MemoryQueueService implements QueueServiceLike {
  private readonly queues = new Map<string, Map<string, QueueEntry>>();

  constructor(private readonly pool: Pool) {}

  async enqueueForDevice(
    recipientDeviceId: string,
    senderDeviceId: string,
    envelope: EncryptedEnvelope
  ): Promise<void> {
    const queue = this.ensureQueue(recipientDeviceId);
    queue.set(envelope.envelopeId, {
      envelope,
      expiresAtMs: Date.now() + QUEUE_TTL_MS
    });

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
    const queue = this.ensureQueue(recipientDeviceId);
    this.pruneExpired(queue);
    return [...queue.values()].map((entry) => entry.envelope);
  }

  async acknowledge(
    recipientDeviceId: string,
    envelopeId: string
  ): Promise<void> {
    const queue = this.ensureQueue(recipientDeviceId);
    queue.delete(envelopeId);

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

  private ensureQueue(deviceId: string): Map<string, QueueEntry> {
    const queue = this.queues.get(deviceId);
    if (queue) {
      return queue;
    }

    const next = new Map<string, QueueEntry>();
    this.queues.set(deviceId, next);
    return next;
  }

  private pruneExpired(queue: Map<string, QueueEntry>): void {
    const now = Date.now();
    for (const [envelopeId, entry] of queue.entries()) {
      if (entry.expiresAtMs <= now) {
        queue.delete(envelopeId);
      }
    }
  }
}
