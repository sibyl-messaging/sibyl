import type { Pool } from "pg";

import { nextId } from "../utils/ids.js";
import { HttpError } from "../utils/httpError.js";

export interface CreateConversationInput {
  creatorUserId: string;
  creatorDeviceId: string;
  recipientUsername: string;
}

export interface CreateConversationResult {
  conversationId: string;
  status: "pending" | "active";
  recipientUserId: string;
}

export interface PendingInvite {
  conversationId: string;
  invitedByUserId: string;
  invitedByUsername: string;
}

export interface ConversationStatus {
  conversationId: string;
  status: "pending" | "active";
  peerUsername: string;
  startedByCurrentUser: boolean;
}

export class ConversationService {
  constructor(private readonly pool: Pool) {}

  async createConversation(
    input: CreateConversationInput
  ): Promise<CreateConversationResult> {
    const normalizedRecipient = input.recipientUsername.trim().toLowerCase();

    const recipient = await this.pool.query<{
      id: string;
      username: string;
      status: string;
      frozen_at: Date | null;
    }>(
      `SELECT id, username, status, frozen_at
       FROM users
       WHERE username = $1`,
      [normalizedRecipient]
    );

    if (!recipient.rowCount) {
      throw new HttpError(404, "Recipient not found");
    }

    const recipientRow = recipient.rows[0]!;
    if (recipientRow.status !== "active" || recipientRow.frozen_at !== null) {
      throw new HttpError(403, "Recipient unavailable");
    }

    if (recipientRow.id === input.creatorUserId) {
      throw new HttpError(400, "Cannot start a conversation with yourself");
    }

    const existing = await this.pool.query<{ conversation_id: string }>(
      `SELECT cm1.conversation_id
       FROM conversation_members cm1
       JOIN conversation_members cm2
         ON cm2.conversation_id = cm1.conversation_id
       JOIN conversations c ON c.id = cm1.conversation_id
       WHERE cm1.user_id = $1
         AND cm2.user_id = $2
         AND c.status = 'active'
       LIMIT 1`,
      [input.creatorUserId, recipientRow.id]
    );

    if (existing.rowCount && existing.rows[0]) {
      return {
        conversationId: existing.rows[0].conversation_id,
        status: "active",
        recipientUserId: recipientRow.id
      };
    }

    const conversationId = nextId("con");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO conversations (id, status, created_by_device_id)
         VALUES ($1, 'pending', $2)`,
        [conversationId, input.creatorDeviceId]
      );

      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role, accepted_at)
         VALUES ($1, $2, 'owner', NOW())`,
        [conversationId, input.creatorUserId]
      );

      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'peer')`,
        [conversationId, recipientRow.id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      conversationId,
      status: "pending",
      recipientUserId: recipientRow.id
    };
  }

  async acceptConversation(
    conversationId: string,
    userId: string
  ): Promise<{ conversationId: string; status: "pending" | "active" }> {
    const membership = await this.pool.query(
      `UPDATE conversation_members
       SET accepted_at = COALESCE(accepted_at, NOW())
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING conversation_id`,
      [conversationId, userId]
    );

    if (!membership.rowCount) {
      throw new HttpError(403, "Not a member of this conversation");
    }

    const pending = await this.pool.query<{ pending_count: string }>(
      `SELECT COUNT(*)::text AS pending_count
       FROM conversation_members
       WHERE conversation_id = $1 AND accepted_at IS NULL`,
      [conversationId]
    );

    const pendingCount = Number(pending.rows[0]?.pending_count ?? "0");
    const status: "pending" | "active" = pendingCount === 0 ? "active" : "pending";
    if (status === "active") {
      await this.pool.query(
        `UPDATE conversations
         SET status = 'active'
         WHERE id = $1`,
        [conversationId]
      );
    }

    return {
      conversationId,
      status
    };
  }

  async assertConversationMember(
    conversationId: string,
    userId: string
  ): Promise<void> {
    const member = await this.pool.query(
      `SELECT 1
       FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId]
    );

    if (!member.rowCount) {
      throw new HttpError(403, "Conversation access denied");
    }
  }

  async assertConversationActiveMember(
    conversationId: string,
    userId: string
  ): Promise<void> {
    const member = await this.pool.query(
      `SELECT 1
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = $1
         AND cm.user_id = $2
         AND cm.accepted_at IS NOT NULL
         AND c.status = 'active'`,
      [conversationId, userId]
    );

    if (!member.rowCount) {
      throw new HttpError(403, "Conversation is not active for this sender");
    }
  }

  async getOtherMemberDeviceIds(
    conversationId: string,
    senderDeviceId: string
  ): Promise<string[]> {
    const devices = await this.pool.query<{ id: string }>(
      `SELECT d.id
       FROM devices d
       JOIN conversation_members cm ON cm.user_id = d.user_id
       WHERE cm.conversation_id = $1
         AND d.id <> $2`,
      [conversationId, senderDeviceId]
    );

    return devices.rows.map((row) => row.id);
  }

  async getActivePeerUserId(
    conversationId: string,
    userId: string
  ): Promise<string> {
    const peer = await this.pool.query<{ user_id: string }>(
      `SELECT peer.user_id
       FROM conversation_members owner
       JOIN conversation_members peer
         ON peer.conversation_id = owner.conversation_id
        AND peer.user_id <> owner.user_id
       JOIN conversations conversation
         ON conversation.id = owner.conversation_id
       WHERE owner.conversation_id = $1
         AND owner.user_id = $2
         AND owner.accepted_at IS NOT NULL
         AND peer.accepted_at IS NOT NULL
         AND conversation.status = 'active'
       LIMIT 1`,
      [conversationId, userId]
    );
    if (!peer.rowCount) {
      throw new HttpError(403, "Conversation is not active for stamp setup");
    }
    return peer.rows[0]!.user_id;
  }

  async getPendingInvitesForUser(userId: string): Promise<PendingInvite[]> {
    const result = await this.pool.query<{
      conversation_id: string;
      invited_by_user_id: string;
      invited_by_username: string;
    }>(
      `SELECT c.id AS conversation_id,
              owner.user_id AS invited_by_user_id,
              owner_user.username AS invited_by_username
       FROM conversations c
       JOIN conversation_members target
         ON target.conversation_id = c.id
       JOIN conversation_members owner
         ON owner.conversation_id = c.id
       JOIN users owner_user
         ON owner_user.id = owner.user_id
       WHERE c.status = 'pending'
         AND target.user_id = $1
         AND target.accepted_at IS NULL
         AND owner.role = 'owner'`,
      [userId]
    );

    return result.rows.map((row) => ({
      conversationId: row.conversation_id,
      invitedByUserId: row.invited_by_user_id,
      invitedByUsername: row.invited_by_username
    }));
  }

  async getConversationStatus(
    conversationId: string,
    userId: string
  ): Promise<ConversationStatus> {
    const result = await this.pool.query<{
      conversation_id: string;
      status: "pending" | "active";
      peer_username: string;
      self_role: "owner" | "peer";
    }>(
      `SELECT conversation.id AS conversation_id,
              conversation.status,
              peer_user.username AS peer_username,
              self.role AS self_role
       FROM conversations conversation
       JOIN conversation_members self
         ON self.conversation_id = conversation.id
       JOIN conversation_members peer
         ON peer.conversation_id = conversation.id
        AND peer.user_id <> self.user_id
       JOIN users peer_user ON peer_user.id = peer.user_id
       WHERE conversation.id = $1
         AND self.user_id = $2
       LIMIT 1`,
      [conversationId, userId]
    );
    if (!result.rowCount) {
      throw new HttpError(404, "Conversation not found");
    }
    const row = result.rows[0]!;
    return {
      conversationId: row.conversation_id,
      status: row.status,
      peerUsername: row.peer_username,
      startedByCurrentUser: row.self_role === "owner"
    };
  }
}
