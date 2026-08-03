import {
  stampHelperAttachmentClaimSchema,
  stampHelperAttachmentClaimStatusSchema,
  stampHelperSlotSchema,
  signedStampCiphertextMessageSchema,
  stampBundleDescriptorSchema,
  type SignedStampCiphertextMessage,
  type StampBundleDescriptor,
  type StampHelperAttachmentClaim,
  type StampHelperAttachmentClaimStatus,
  type StampHelperSlot
} from "@sibyl/protocol";
import { z } from "zod";

import type { AuthSession } from "../types/app";

const authChallengeSchema = z.object({
  challengeId: z.string(),
  nonce: z.string(),
  expiresAt: z.string()
});

const authVerifySchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSec: z.number().int().positive(),
  auth: z.object({
    userId: z.string(),
    username: z.string(),
    deviceId: z.string()
  })
});

const lookupSchema = z.object({
  id: z.string(),
  username: z.string(),
  status: z.string(),
  devices: z.array(
    z.object({
      id: z.string(),
      x25519PublicKey: z.string()
    })
  )
});

const createConversationSchema = z.object({
  conversationId: z.string(),
  status: z.string()
});

const createStampBundleResponseSchema = z.object({
  descriptor: stampBundleDescriptorSchema,
  helperSlots: z.array(stampHelperSlotSchema)
});

const sendStampMessageResponseSchema = z.object({
  messageId: z.string(),
  bundleId: z.string(),
  status: z.literal("accepted")
});

const pendingStampMessagesSchema = z.object({
  messages: z.array(signedStampCiphertextMessageSchema)
});

export interface RelayUserLookup {
  id: string;
  username: string;
  status: string;
  devices: Array<{
    id: string;
    x25519PublicKey: string;
  }>;
}

export type WsEventFrame = {
  event: string;
  data: unknown;
};

export class TransportClient {
  private ws: WebSocket | null = null;

  constructor(private readonly relayUrl: string) {}

  async registerUser(input: {
    username: string;
    deviceId: string;
    signingPublicKey: string;
    x25519PublicKey: string;
  }): Promise<void> {
    const response = await fetch(`${this.relayUrl}/v1/users/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      return;
    }

    if (response.status === 409) {
      return;
    }

    throw new Error(`register failed (${response.status})`);
  }

  async createChallenge(
    username: string,
    deviceId: string
  ): Promise<{ challengeId: string; nonce: string }> {
    const response = await fetch(`${this.relayUrl}/v1/auth/challenge`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ username, deviceId })
    });

    if (!response.ok) {
      throw new Error(`challenge failed (${response.status})`);
    }

    const payload = authChallengeSchema.parse(await response.json());
    return {
      challengeId: payload.challengeId,
      nonce: payload.nonce
    };
  }

  async verifyChallenge(
    challengeId: string,
    signature: string
  ): Promise<AuthSession> {
    const response = await fetch(`${this.relayUrl}/v1/auth/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ challengeId, signature })
    });

    if (!response.ok) {
      throw new Error(`verify failed (${response.status})`);
    }

    const payload = authVerifySchema.parse(await response.json());
    return {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      auth: payload.auth
    };
  }

  async lookupUser(
    accessToken: string,
    username: string
  ): Promise<RelayUserLookup> {
    const response = await fetch(
      `${this.relayUrl}/v1/users/lookup?username=${encodeURIComponent(username)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`lookup failed (${response.status})`);
    }

    return lookupSchema.parse(await response.json());
  }

  async createConversation(
    accessToken: string,
    recipientUsername: string
  ): Promise<{ conversationId: string; status: string }> {
    const response = await fetch(`${this.relayUrl}/v1/conversations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ recipientUsername })
    });

    if (!response.ok) {
      throw new Error(`create conversation failed (${response.status})`);
    }

    const payload = createConversationSchema.parse(await response.json());
    return {
      conversationId: payload.conversationId,
      status: payload.status
    };
  }

  async savePushToken(
    accessToken: string,
    platform: "ios" | "android",
    pushToken: string
  ): Promise<void> {
    const response = await fetch(`${this.relayUrl}/v1/devices/push-token`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ platform, pushToken })
    });

    if (!response.ok) {
      throw new Error(`push token save failed (${response.status})`);
    }
  }

  async createStampBundle(
    accessToken: string,
    conversationId: string,
    shareCount: number
  ): Promise<{
    descriptor: StampBundleDescriptor;
    helperSlots: StampHelperSlot[];
  }> {
    const response = await fetch(`${this.relayUrl}/v2/stamp-bundles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ conversationId, shareCount })
    });
    if (!response.ok) {
      throw new Error(`stamp bundle creation failed (${response.status})`);
    }
    return createStampBundleResponseSchema.parse(await response.json());
  }

  async attachStampHelper(
    accessToken: string,
    input: {
      bundleId: string;
      pairId: string;
      registrationId: string;
      linkCode: string;
    }
  ): Promise<StampHelperAttachmentClaim> {
    const response = await fetch(`${this.relayUrl}/v2/stamp-helpers/attach`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error(`helper attachment failed (${response.status})`);
    }
    return stampHelperAttachmentClaimSchema.parse(await response.json());
  }

  async getStampHelperClaim(
    accessToken: string,
    claimId: string
  ): Promise<StampHelperAttachmentClaimStatus> {
    const response = await fetch(
      `${this.relayUrl}/v2/stamp-helper-claims/${encodeURIComponent(claimId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` }
      }
    );
    if (!response.ok) {
      throw new Error(`helper link check failed (${response.status})`);
    }
    return stampHelperAttachmentClaimStatusSchema.parse(await response.json());
  }

  async getStampBundle(
    accessToken: string,
    bundleId: string
  ): Promise<StampBundleDescriptor> {
    const response = await fetch(
      `${this.relayUrl}/v2/stamp-bundles/${encodeURIComponent(bundleId)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      }
    );
    if (!response.ok) {
      throw new Error(`stamp bundle lookup failed (${response.status})`);
    }
    return stampBundleDescriptorSchema.parse(await response.json());
  }

  async sendStampMessage(
    accessToken: string,
    message: SignedStampCiphertextMessage
  ): Promise<{ messageId: string; bundleId: string; status: "accepted" }> {
    const response = await fetch(`${this.relayUrl}/v2/stamp-messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(signedStampCiphertextMessageSchema.parse(message))
    });
    if (!response.ok) {
      throw new Error(`stamp message send failed (${response.status})`);
    }
    return sendStampMessageResponseSchema.parse(await response.json());
  }

  async getPendingStampMessages(
    accessToken: string
  ): Promise<SignedStampCiphertextMessage[]> {
    const response = await fetch(`${this.relayUrl}/v2/stamp-messages`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      throw new Error(`stamp message fetch failed (${response.status})`);
    }
    return pendingStampMessagesSchema.parse(await response.json()).messages;
  }

  async acknowledgeStampMessage(
    accessToken: string,
    messageId: string
  ): Promise<void> {
    const response = await fetch(`${this.relayUrl}/v2/stamp-messages/ack`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ messageId })
    });
    if (!response.ok) {
      throw new Error(`stamp message acknowledgement failed (${response.status})`);
    }
  }

  connectSocket(
    accessToken: string,
    onEvent: (frame: WsEventFrame) => void
  ): void {
    this.closeSocket();

    const wsUrl = `${this.relayUrl.replace(/^http/, "ws")}/ws?accessToken=${encodeURIComponent(accessToken)}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as WsEventFrame;
      onEvent(data);
    };
  }

  sendWsEvent(event: string, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        event,
        data
      })
    );
  }

  closeSocket(): void {
    this.ws?.close();
    this.ws = null;
  }
}
