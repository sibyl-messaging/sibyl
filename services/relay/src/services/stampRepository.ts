import type {
  SignedStampCiphertextMessage,
  StampBundleDescriptor,
  StampHelperAttachmentClaim,
  StampHelperRole,
  StampHelperSlot,
  StampHelperStatus
} from "@sibyl/protocol";
import type { Pool, PoolClient } from "pg";

export interface StampPairCreateRecord {
  pairId: string;
  shareIndex: number;
}

export interface CreateStampBundleRecord {
  bundleId: string;
  sessionId: string;
  conversationId: string;
  initiatorUserId: string;
  recipientUserId: string;
  shareCount: number;
  expiresAtMs: number;
  pairs: StampPairCreateRecord[];
}

export interface RegisterStampHelperRecord {
  registrationId: string;
  accessTokenHash: string;
  hpkePublicKey: string;
  expiresAtMs: number;
}

export interface CreateStampHelperClaimRecord {
  claimId: string;
  bundleId: string;
  pairId: string;
  registrationId: string;
  userId: string;
  linkCodeHash: string;
  nowMs: number;
}

export type StoredStampHelperClaim = Omit<
  StampHelperAttachmentClaim,
  "version" | "linkCode"
>;

export interface StampRelayRepository {
  createBundle(input: CreateStampBundleRecord): Promise<StampBundleDescriptor>;
  getBundleForUser(
    bundleId: string,
    userId: string
  ): Promise<StampBundleDescriptor | null>;
  getBundleById(bundleId: string): Promise<StampBundleDescriptor | null>;
  getLatestBundleForConversationAndUser(
    conversationId: string,
    userId: string,
    nowMs: number
  ): Promise<StampBundleDescriptor | null>;
  getHelperSlots(
    bundleId: string,
    role: StampHelperRole
  ): Promise<StampHelperSlot[]>;
  getCompletedShareIndexes(
    bundleId: string,
    role: StampHelperRole
  ): Promise<number[]>;
  registerHelper(input: RegisterStampHelperRecord): Promise<void>;
  createAttachmentClaim(
    input: CreateStampHelperClaimRecord
  ): Promise<StoredStampHelperClaim | null>;
  getAttachmentClaim(
    claimId: string,
    userId: string,
    nowMs: number
  ): Promise<StoredStampHelperClaim | null>;
  approveAttachmentClaim(
    tokenHash: string,
    linkCodeHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null>;
  publishHpkeEncapsulation(
    tokenHash: string,
    hpkeEncapsulation: string,
    nowMs: number
  ): Promise<StampHelperStatus | null>;
  getHelperStatus(
    tokenHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null>;
  confirmHelper(
    tokenHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null>;
  consumeBundleAndStoreMessage(
    message: SignedStampCiphertextMessage,
    nowMs: number
  ): Promise<boolean>;
  getPendingMessages(userId: string): Promise<SignedStampCiphertextMessage[]>;
  acknowledgeMessage(messageId: string, userId: string): Promise<boolean>;
}

interface BundleRow {
  id: string;
  session_id: string;
  initiator_user_id: string;
  recipient_user_id: string;
  share_count: number;
  bundle_sequence: number;
  state: StampBundleDescriptor["state"];
  created_at: Date;
}

interface ClaimRow {
  claim_id: string;
  pair_id: string;
  bundle_id: string;
  share_index: number;
  role: StampHelperRole;
  expires_at: Date;
  approved_at: Date | null;
  helper_confirmed_at: Date | null;
  registration_attached_at: Date | null;
}

interface HelperStatusRow {
  registration_id: string;
  own_public_key: string;
  pair_id: string | null;
  bundle_id: string | null;
  share_index: number | null;
  role: StampHelperRole | null;
  pair_state: "waiting" | "paired" | "confirmed" | null;
  hpke_encapsulation: string | null;
  peer_public_key: string | null;
  own_confirmed_at: Date | null;
  peer_confirmed_at: Date | null;
  expires_at: Date;
  session_id: string | null;
  initiator_user_id: string | null;
  recipient_user_id: string | null;
  bundle_sequence: number | null;
  has_pending_claim: boolean;
}

interface MessageRow {
  version: 2;
  id: string;
  conversation_id: string;
  bundle_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  ciphertext: string;
  client_created_at: Date;
  sender_signing_key_id: string;
  signature: string;
}

export class PostgresStampRelayRepository implements StampRelayRepository {
  constructor(private readonly pool: Pool) {}

  async createBundle(
    input: CreateStampBundleRecord
  ): Promise<StampBundleDescriptor> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM conversations WHERE id = $1 FOR UPDATE",
        [input.conversationId]
      );
      const sequenceResult = await client.query<{ next_sequence: number }>(
        `SELECT COALESCE(MAX(bundle_sequence), -1) + 1 AS next_sequence
         FROM stamp_bundles
         WHERE conversation_id = $1
           AND initiator_user_id = $2
           AND recipient_user_id = $3`,
        [input.conversationId, input.initiatorUserId, input.recipientUserId]
      );
      const bundleSequence = Number(sequenceResult.rows[0]?.next_sequence ?? 0);
      const bundleResult = await client.query<BundleRow>(
        `INSERT INTO stamp_bundles (
           id, session_id, conversation_id, initiator_user_id,
           recipient_user_id, share_count, bundle_sequence, state, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', $8)
         RETURNING id, session_id, initiator_user_id, recipient_user_id,
                   share_count, bundle_sequence, state, created_at`,
        [
          input.bundleId,
          input.sessionId,
          input.conversationId,
          input.initiatorUserId,
          input.recipientUserId,
          input.shareCount,
          bundleSequence,
          new Date(input.expiresAtMs).toISOString()
        ]
      );
      for (const pair of input.pairs) {
        await this.insertPair(client, input.bundleId, pair);
      }
      await client.query("COMMIT");
      return mapBundleRow(bundleResult.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getBundleForUser(
    bundleId: string,
    userId: string
  ): Promise<StampBundleDescriptor | null> {
    return this.queryBundle(bundleId, userId);
  }

  async getBundleById(bundleId: string): Promise<StampBundleDescriptor | null> {
    return this.queryBundle(bundleId);
  }

  async getLatestBundleForConversationAndUser(
    conversationId: string,
    userId: string,
    nowMs: number
  ): Promise<StampBundleDescriptor | null> {
    const result = await this.pool.query<BundleRow>(
      `SELECT id, session_id, initiator_user_id, recipient_user_id,
              share_count, bundle_sequence, state, created_at
       FROM stamp_bundles
       WHERE conversation_id = $1
         AND ($2 = initiator_user_id OR $2 = recipient_user_id)
         AND state IN ('proposed', 'pairing', 'ready')
         AND expires_at > $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [conversationId, userId, new Date(nowMs).toISOString()]
    );
    return result.rows[0] ? mapBundleRow(result.rows[0]) : null;
  }

  async getHelperSlots(
    bundleId: string,
    role: StampHelperRole
  ): Promise<StampHelperSlot[]> {
    const result = await this.pool.query<{
      pair_id: string;
      share_index: number;
      expires_at: Date;
    }>(
      `SELECT pair.id AS pair_id, pair.share_index, bundle.expires_at
       FROM stamp_helper_pairs pair
       JOIN stamp_bundles bundle ON bundle.id = pair.bundle_id
       WHERE pair.bundle_id = $1
       ORDER BY pair.share_index ASC`,
      [bundleId]
    );
    return result.rows.map((row) => ({
      version: 2,
      pairId: row.pair_id,
      bundleId,
      shareIndex: row.share_index,
      role,
      expiresAtMs: row.expires_at.getTime()
    }));
  }

  async getCompletedShareIndexes(
    bundleId: string,
    role: StampHelperRole
  ): Promise<number[]> {
    const result = await this.pool.query<{ share_index: number }>(
      `SELECT pair.share_index
       FROM stamp_helper_pairs pair
       JOIN stamp_helper_sides side ON side.pair_id = pair.id
       WHERE pair.bundle_id = $1
         AND side.role = $2
         AND side.confirmed_at IS NOT NULL
       ORDER BY pair.share_index ASC`,
      [bundleId, role]
    );
    return result.rows.map((row) => row.share_index);
  }

  async registerHelper(input: RegisterStampHelperRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO stamp_helper_registrations (
         id, access_token_hash, hpke_public_key, expires_at
       ) VALUES ($1, $2, $3, $4)`,
      [
        input.registrationId,
        input.accessTokenHash,
        input.hpkePublicKey,
        new Date(input.expiresAtMs).toISOString()
      ]
    );
  }

  async createAttachmentClaim(
    input: CreateStampHelperClaimRecord
  ): Promise<StoredStampHelperClaim | null> {
    const claimed = await this.pool.query<ClaimRow>(
      `WITH inserted AS (
         INSERT INTO stamp_helper_attachment_claims (
           id, registration_id, pair_id, role, claimant_user_id,
           link_code_hash, expires_at
         )
         SELECT $1,
                registration.id,
                pair.id,
                side.role,
                $5,
                $6,
                LEAST(registration.expires_at, bundle.expires_at)
         FROM stamp_helper_registrations registration
         JOIN stamp_helper_pairs pair ON pair.id = $3 AND pair.bundle_id = $2
         JOIN stamp_bundles bundle ON bundle.id = pair.bundle_id
         JOIN stamp_helper_sides side ON side.pair_id = pair.id
         WHERE registration.id = $4
           AND registration.expires_at > $7
           AND registration.attached_at IS NULL
           AND bundle.expires_at > $7
           AND bundle.state IN ('proposed', 'pairing')
           AND side.helper_registration_id IS NULL
           AND (
             (side.role = 'initiator' AND bundle.initiator_user_id = $5) OR
             (side.role = 'recipient' AND bundle.recipient_user_id = $5)
           )
         ON CONFLICT (registration_id, link_code_hash) DO NOTHING
         RETURNING id, registration_id, pair_id, role, expires_at, approved_at
       )
       SELECT inserted.id AS claim_id,
              pair.id AS pair_id,
              pair.bundle_id,
              pair.share_index,
              inserted.role,
              inserted.expires_at,
              inserted.approved_at,
              NULL::TIMESTAMPTZ AS helper_confirmed_at,
              registration.attached_at AS registration_attached_at
       FROM inserted
       JOIN stamp_helper_pairs pair ON pair.id = inserted.pair_id
       JOIN stamp_helper_registrations registration
         ON registration.id = inserted.registration_id`,
      [
        input.claimId,
        input.bundleId,
        input.pairId,
        input.registrationId,
        input.userId,
        input.linkCodeHash,
        new Date(input.nowMs).toISOString()
      ]
    );
    return claimed.rows[0]
      ? mapStoredClaimRow(claimed.rows[0], input.nowMs)
      : null;
  }

  async getAttachmentClaim(
    claimId: string,
    userId: string,
    nowMs: number
  ): Promise<StoredStampHelperClaim | null> {
    const result = await this.pool.query<ClaimRow>(
      `SELECT claim.id AS claim_id,
              pair.id AS pair_id,
              pair.bundle_id,
              pair.share_index,
              claim.role,
              claim.expires_at,
              claim.approved_at,
              side.confirmed_at AS helper_confirmed_at,
              registration.attached_at AS registration_attached_at
       FROM stamp_helper_attachment_claims claim
       JOIN stamp_helper_registrations registration
         ON registration.id = claim.registration_id
       JOIN stamp_helper_pairs pair ON pair.id = claim.pair_id
       JOIN stamp_helper_sides side
         ON side.pair_id = claim.pair_id AND side.role = claim.role
       WHERE claim.id = $1
         AND claim.claimant_user_id = $2`,
      [claimId, userId]
    );
    return result.rows[0] ? mapStoredClaimRow(result.rows[0], nowMs) : null;
  }

  async approveAttachmentClaim(
    tokenHash: string,
    linkCodeHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{
        claim_id: string;
        registration_id: string;
        pair_id: string;
        bundle_id: string;
        role: StampHelperRole;
        hpke_public_key: string;
      }>(
        `SELECT claim.id AS claim_id,
                registration.id AS registration_id,
                pair.id AS pair_id,
                pair.bundle_id,
                claim.role,
                registration.hpke_public_key
         FROM stamp_helper_attachment_claims claim
         JOIN stamp_helper_registrations registration
           ON registration.id = claim.registration_id
         JOIN stamp_helper_pairs pair ON pair.id = claim.pair_id
         JOIN stamp_bundles bundle ON bundle.id = pair.bundle_id
         JOIN stamp_helper_sides side
           ON side.pair_id = pair.id AND side.role = claim.role
         WHERE registration.access_token_hash = $1
           AND claim.link_code_hash = $2
           AND claim.approved_at IS NULL
           AND claim.expires_at > $3
           AND registration.expires_at > $3
           AND registration.attached_at IS NULL
           AND bundle.expires_at > $3
           AND bundle.state IN ('proposed', 'pairing')
           AND side.helper_registration_id IS NULL
         FOR UPDATE OF claim, registration, side`,
        [tokenHash, linkCodeHash, new Date(nowMs).toISOString()]
      );
      const claim = selected.rows[0];
      if (!claim) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `UPDATE stamp_helper_sides
         SET helper_registration_id = $1,
             hpke_public_key = $2,
             joined_at = NOW()
         WHERE pair_id = $3
           AND role = $4
           AND helper_registration_id IS NULL`,
        [
          claim.registration_id,
          claim.hpke_public_key,
          claim.pair_id,
          claim.role
        ]
      );
      await client.query(
        `UPDATE stamp_helper_registrations
         SET attached_at = NOW()
         WHERE id = $1 AND attached_at IS NULL`,
        [claim.registration_id]
      );
      await client.query(
        `UPDATE stamp_helper_attachment_claims
         SET approved_at = NOW()
         WHERE id = $1`,
        [claim.claim_id]
      );
      await client.query(
        `UPDATE stamp_bundles
         SET state = 'pairing'
         WHERE id = $1 AND state = 'proposed'`,
        [claim.bundle_id]
      );
      await client.query(
        `UPDATE stamp_helper_pairs pair
         SET state = 'paired'
         WHERE pair.id = $1
           AND pair.state = 'waiting'
           AND 2 = (
             SELECT COUNT(*)
             FROM stamp_helper_sides side
             WHERE side.pair_id = pair.id
               AND side.helper_registration_id IS NOT NULL
           )`,
        [claim.pair_id]
      );
      await client.query("COMMIT");
      return this.getHelperStatus(tokenHash, nowMs);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async publishHpkeEncapsulation(
    tokenHash: string,
    hpkeEncapsulation: string,
    nowMs: number
  ): Promise<StampHelperStatus | null> {
    const published = await this.pool.query(
      `UPDATE stamp_helper_pairs pair
       SET hpke_encapsulation = COALESCE(pair.hpke_encapsulation, $2)
       FROM stamp_helper_sides side,
            stamp_helper_registrations registration,
            stamp_bundles bundle
       WHERE registration.access_token_hash = $1
         AND registration.id = side.helper_registration_id
         AND side.role = 'initiator'
         AND side.pair_id = pair.id
         AND pair.bundle_id = bundle.id
         AND pair.state = 'paired'
         AND bundle.state = 'pairing'
         AND registration.expires_at > $3
         AND bundle.expires_at > $3
         AND (
           pair.hpke_encapsulation IS NULL OR
           pair.hpke_encapsulation = $2
         )
       RETURNING pair.id`,
      [tokenHash, hpkeEncapsulation, new Date(nowMs).toISOString()]
    );
    return published.rowCount
      ? this.getHelperStatus(tokenHash, nowMs)
      : null;
  }

  async getHelperStatus(
    tokenHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null> {
    const result = await this.pool.query<HelperStatusRow>(
      `SELECT registration.id AS registration_id,
              registration.hpke_public_key AS own_public_key,
              pair.id AS pair_id,
              pair.bundle_id,
              pair.share_index,
              own.role,
              pair.state AS pair_state,
              pair.hpke_encapsulation,
              peer_registration.hpke_public_key AS peer_public_key,
              own.confirmed_at AS own_confirmed_at,
              peer.confirmed_at AS peer_confirmed_at,
              COALESCE(LEAST(registration.expires_at, bundle.expires_at), registration.expires_at) AS expires_at,
              bundle.session_id,
              bundle.initiator_user_id,
              bundle.recipient_user_id,
              bundle.bundle_sequence,
              EXISTS (
                SELECT 1
                FROM stamp_helper_attachment_claims pending_claim
                WHERE pending_claim.registration_id = registration.id
                  AND pending_claim.approved_at IS NULL
                  AND pending_claim.expires_at > $2
              ) AS has_pending_claim
       FROM stamp_helper_registrations registration
       LEFT JOIN stamp_helper_sides own
         ON own.helper_registration_id = registration.id
       LEFT JOIN stamp_helper_pairs pair ON pair.id = own.pair_id
       LEFT JOIN stamp_bundles bundle ON bundle.id = pair.bundle_id
       LEFT JOIN stamp_helper_sides peer
         ON peer.pair_id = own.pair_id AND peer.role <> own.role
       LEFT JOIN stamp_helper_registrations peer_registration
         ON peer_registration.id = peer.helper_registration_id
       WHERE registration.access_token_hash = $1
         AND registration.expires_at > $2`,
      [tokenHash, new Date(nowMs).toISOString()]
    );
    return result.rows[0] ? mapHelperStatusRow(result.rows[0]) : null;
  }

  async confirmHelper(
    tokenHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const confirmed = await client.query(
        `UPDATE stamp_helper_sides side
         SET confirmed_at = COALESCE(side.confirmed_at, NOW())
         FROM stamp_helper_registrations registration
         WHERE registration.access_token_hash = $1
           AND registration.id = side.helper_registration_id
           AND registration.expires_at > $2
           AND EXISTS (
             SELECT 1
             FROM stamp_helper_pairs pair
             JOIN stamp_bundles bundle ON bundle.id = pair.bundle_id
             WHERE pair.id = side.pair_id
               AND pair.state IN ('paired', 'confirmed')
               AND pair.hpke_encapsulation IS NOT NULL
               AND bundle.expires_at > $2
               AND bundle.state IN ('pairing', 'ready')
           )
         RETURNING side.pair_id`,
        [tokenHash, new Date(nowMs).toISOString()]
      );
      if (!confirmed.rowCount) {
        await client.query("ROLLBACK");
        return null;
      }

      const pairId = (confirmed.rows[0] as { pair_id: string }).pair_id;
      await client.query(
        `UPDATE stamp_helper_pairs pair
         SET state = 'confirmed'
         WHERE pair.id = $1
           AND 2 = (
             SELECT COUNT(*)
             FROM stamp_helper_sides side
             WHERE side.pair_id = pair.id
               AND side.confirmed_at IS NOT NULL
           )`,
        [pairId]
      );
      await client.query(
        `UPDATE stamp_bundles bundle
         SET state = 'ready'
         FROM stamp_helper_pairs current_pair
         WHERE current_pair.id = $1
           AND current_pair.bundle_id = bundle.id
           AND bundle.state = 'pairing'
           AND NOT EXISTS (
             SELECT 1
             FROM stamp_helper_pairs pair
             WHERE pair.bundle_id = bundle.id
               AND pair.state <> 'confirmed'
           )`,
        [pairId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.getHelperStatus(tokenHash, nowMs);
  }

  async consumeBundleAndStoreMessage(
    message: SignedStampCiphertextMessage,
    nowMs: number
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query(
        `UPDATE stamp_bundles
         SET state = 'consumed',
             consumed_message_id = $1,
             consumed_at = NOW()
         WHERE id = $2
           AND conversation_id = $3
           AND initiator_user_id = $4
           AND recipient_user_id = $5
           AND state = 'ready'
           AND expires_at > $6
         RETURNING id`,
        [
          message.messageId,
          message.bundleId,
          message.conversationId,
          message.senderUserId,
          message.recipientUserId,
          new Date(nowMs).toISOString()
        ]
      );
      if (!consumed.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO stamp_messages (
           id, version, conversation_id, bundle_id, sender_user_id,
           recipient_user_id, ciphertext, sender_signing_key_id,
           signature, client_created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          message.messageId,
          message.version,
          message.conversationId,
          message.bundleId,
          message.senderUserId,
          message.recipientUserId,
          message.ciphertext,
          message.senderSigningKeyId,
          message.signature,
          new Date(message.createdAtMs).toISOString()
        ]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPendingMessages(userId: string): Promise<SignedStampCiphertextMessage[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT version, id, conversation_id, bundle_id, sender_user_id,
              recipient_user_id, ciphertext, client_created_at,
              sender_signing_key_id, signature
       FROM stamp_messages
       WHERE recipient_user_id = $1
         AND acknowledged_at IS NULL
       ORDER BY accepted_at ASC`,
      [userId]
    );
    return result.rows.map(mapMessageRow);
  }

  async acknowledgeMessage(messageId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE stamp_messages
       SET acknowledged_at = COALESCE(acknowledged_at, NOW())
       WHERE id = $1 AND recipient_user_id = $2
       RETURNING id`,
      [messageId, userId]
    );
    return Boolean(result.rowCount);
  }

  private async insertPair(
    client: PoolClient,
    bundleId: string,
    pair: StampPairCreateRecord
  ): Promise<void> {
    await client.query(
      `INSERT INTO stamp_helper_pairs (id, bundle_id, share_index)
       VALUES ($1, $2, $3)`,
      [pair.pairId, bundleId, pair.shareIndex]
    );
    await client.query(
      `INSERT INTO stamp_helper_sides (pair_id, role)
       VALUES ($1, 'initiator'), ($1, 'recipient')`,
      [pair.pairId]
    );
  }

  private async queryBundle(
    bundleId: string,
    userId?: string
  ): Promise<StampBundleDescriptor | null> {
    const values: string[] = [bundleId];
    const userClause = userId
      ? "AND (initiator_user_id = $2 OR recipient_user_id = $2)"
      : "";
    if (userId) values.push(userId);
    const result = await this.pool.query<BundleRow>(
      `SELECT id, session_id, initiator_user_id, recipient_user_id,
              share_count, bundle_sequence, state, created_at
       FROM stamp_bundles
       WHERE id = $1 ${userClause}`,
      values
    );
    return result.rows[0] ? mapBundleRow(result.rows[0]) : null;
  }
}

function mapBundleRow(row: BundleRow): StampBundleDescriptor {
  return {
    version: 2,
    sessionId: row.session_id,
    bundleId: row.id,
    initiatorUserId: row.initiator_user_id,
    recipientUserId: row.recipient_user_id,
    shareCount: row.share_count,
    bundleSequence: row.bundle_sequence,
    createdAtMs: row.created_at.getTime(),
    state: row.state
  };
}

function mapStoredClaimRow(
  row: ClaimRow,
  nowMs: number
): StoredStampHelperClaim {
  return {
    claimId: row.claim_id,
    pairId: row.pair_id,
    bundleId: row.bundle_id,
    shareIndex: row.share_index,
    role: row.role,
    state: row.helper_confirmed_at
      ? "completed"
      : row.approved_at
        ? "approved"
      : row.expires_at.getTime() <= nowMs || row.registration_attached_at !== null
        ? "expired"
        : "pending",
    expiresAtMs: row.expires_at.getTime()
  };
}

function mapHelperStatusRow(row: HelperStatusRow): StampHelperStatus {
  const attached = row.pair_id !== null;
  const hasPeer = row.peer_public_key !== null;
  const state: StampHelperStatus["state"] = !attached
    ? row.has_pending_claim
      ? "waiting_for_code"
      : "waiting_for_scan"
    : !hasPeer
      ? "waiting_for_partner"
      : row.pair_state === "confirmed"
        ? "confirmed"
        : "paired";
  const shareContext =
    row.session_id &&
    row.bundle_id &&
    row.initiator_user_id &&
    row.recipient_user_id &&
    row.share_index !== null &&
    row.bundle_sequence !== null
      ? {
          version: 2 as const,
          sessionId: row.session_id,
          bundleId: row.bundle_id,
          initiatorUserId: row.initiator_user_id,
          recipientUserId: row.recipient_user_id,
          shareIndex: row.share_index,
          bundleSequence: row.bundle_sequence
        }
      : null;
  return {
    version: 2,
    registrationId: row.registration_id,
    state,
    pairId: row.pair_id,
    bundleId: row.bundle_id,
    shareIndex: row.share_index,
    role: row.role,
    shareContext,
    ownHpkePublicKey: row.own_public_key,
    peerHpkePublicKey: row.peer_public_key,
    hpkeEncapsulation: row.hpke_encapsulation,
    ownConfirmed: row.own_confirmed_at !== null,
    peerConfirmed: row.peer_confirmed_at !== null,
    expiresAtMs: row.expires_at.getTime()
  };
}

function mapMessageRow(row: MessageRow): SignedStampCiphertextMessage {
  return {
    version: row.version,
    messageId: row.id,
    conversationId: row.conversation_id,
    bundleId: row.bundle_id,
    senderUserId: row.sender_user_id,
    recipientUserId: row.recipient_user_id,
    ciphertext: row.ciphertext,
    createdAtMs: row.client_created_at.getTime(),
    senderSigningKeyId: row.sender_signing_key_id,
    signature: row.signature
  };
}
