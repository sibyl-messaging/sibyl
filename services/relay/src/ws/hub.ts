import type { Server } from "node:http";

import {
  assertNoPlaintextField,
  encryptedEnvelopeSchema,
  type EncryptedEnvelope
} from "../protocol/envelope.js";
import type { FastifyBaseLogger } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import type { AuthContext } from "../types/domain.js";
import type { ServiceContainer, WsHubLike } from "../types/services.js";

const clientEventSchema = z.object({
  event: z.string().min(1),
  data: z.unknown().optional()
});

const conversationAcceptSchema = z.object({
  conversationId: z.string().min(1)
});

const ackSchema = z.object({
  envelopeId: z.string().min(1)
});

interface SocketSession {
  ws: WebSocket;
  auth: AuthContext;
}

export class WsHub implements WsHubLike {
  private readonly server: WebSocketServer;
  private readonly sessionsByDevice = new Map<string, SocketSession>();
  private readonly deviceIdsByUser = new Map<string, Set<string>>();

  constructor(
    httpServer: Server,
    private readonly services: ServiceContainer,
    private readonly logger: FastifyBaseLogger
  ) {
    this.server = new WebSocketServer({
      server: httpServer,
      path: "/ws"
    });

    this.server.on("connection", (ws, request) => {
      void this.onConnection(ws, request.url ?? "");
    });
  }

  sendToUser(userId: string, event: string, data: unknown): void {
    const deviceIds = this.deviceIdsByUser.get(userId);
    if (!deviceIds) {
      return;
    }

    for (const deviceId of deviceIds) {
      this.sendToDevice(deviceId, event, data);
    }
  }

  isUserOnline(userId: string): boolean {
    return (this.deviceIdsByUser.get(userId)?.size ?? 0) > 0;
  }

  sendToDevice(deviceId: string, event: string, data: unknown): void {
    const session = this.sessionsByDevice.get(deviceId);
    if (!session) {
      return;
    }

    this.send(session.ws, event, data);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async onConnection(ws: WebSocket, requestUrl: string): Promise<void> {
    try {
      const accessToken = extractAccessToken(requestUrl);
      if (!accessToken) {
        ws.close(4001, "missing_token");
        return;
      }

      let auth: AuthContext;
      try {
        auth = await this.services.authService.verifyAccessToken(accessToken);
      } catch {
        ws.close(4002, "invalid_token");
        return;
      }

      this.registerSession({ ws, auth });

      ws.on("message", (payload) => {
        void this.onMessage(auth, ws, payload.toString());
      });

      ws.on("close", () => {
        this.unregisterSession(auth);
      });

      await this.pushInitialState(auth, ws);
    } catch (error) {
      this.logger.error({ err: error }, "ws.connection.failed");
      ws.close(1011, "internal_error");
    }
  }

  private registerSession(session: SocketSession): void {
    const existing = this.sessionsByDevice.get(session.auth.deviceId);
    if (existing && existing.ws !== session.ws) {
      existing.ws.close(4000, "replaced");
    }

    this.sessionsByDevice.set(session.auth.deviceId, session);

    const devices = this.deviceIdsByUser.get(session.auth.userId) ?? new Set<string>();
    devices.add(session.auth.deviceId);
    this.deviceIdsByUser.set(session.auth.userId, devices);
  }

  private unregisterSession(auth: AuthContext): void {
    this.sessionsByDevice.delete(auth.deviceId);

    const devices = this.deviceIdsByUser.get(auth.userId);
    if (!devices) {
      return;
    }

    devices.delete(auth.deviceId);
    if (devices.size === 0) {
      this.deviceIdsByUser.delete(auth.userId);
    }
  }

  private async pushInitialState(auth: AuthContext, ws: WebSocket): Promise<void> {
    const invites = await this.services.conversationService.getPendingInvitesForUser(
      auth.userId
    );

    for (const invite of invites) {
      this.send(ws, "conversation.invite", {
        conversationId: invite.conversationId,
        fromUsername: invite.invitedByUsername
      });
    }

    const stampMessages = await this.services.stampService.getPendingMessages(
      auth.userId
    );
    for (const message of stampMessages) {
      this.send(ws, "stamp.message", message);
    }

    await this.flushQueue(auth.deviceId, ws);
  }

  private async onMessage(
    auth: AuthContext,
    ws: WebSocket,
    payload: string
  ): Promise<void> {
    try {
      const frame = clientEventSchema.parse(JSON.parse(payload));

      switch (frame.event) {
        case "queue.sync": {
          await this.flushQueue(auth.deviceId, ws);
          return;
        }
        case "conversation.accept": {
          const body = conversationAcceptSchema.parse(frame.data);
          const result = await this.services.conversationService.acceptConversation(
            body.conversationId,
            auth.userId
          );

          this.send(ws, "conversation.accept", result);

          const others = await this.services.conversationService.getOtherMemberDeviceIds(
            body.conversationId,
            auth.deviceId
          );

          for (const deviceId of others) {
            this.sendToDevice(deviceId, "conversation.accept", result);
          }
          return;
        }
        case "message.envelope": {
          const envelope = encryptedEnvelopeSchema.parse(frame.data);
          assertNoPlaintextField(envelope as unknown as Record<string, unknown>);

          await this.handleEnvelope(auth, envelope, ws);
          return;
        }
        case "message.ack": {
          const body = ackSchema.parse(frame.data);
          await this.services.queueService.acknowledge(auth.deviceId, body.envelopeId);
          return;
        }
        default:
          this.send(ws, "error", {
            message: `Unsupported event: ${frame.event}`
          });
      }
    } catch (error) {
      this.logger.warn({ err: error }, "ws.message.failed");
      this.send(ws, "error", {
        message: "Malformed event payload"
      });
    }
  }

  private async handleEnvelope(
    auth: AuthContext,
    envelope: EncryptedEnvelope,
    ws: WebSocket
  ): Promise<void> {
    await this.services.conversationService.assertConversationActiveMember(
      envelope.conversationId,
      auth.userId
    );

    const recipientDeviceIds = await this.services.conversationService.getOtherMemberDeviceIds(
      envelope.conversationId,
      auth.deviceId
    );

    for (const recipientDeviceId of recipientDeviceIds) {
      await this.services.queueService.enqueueForDevice(
        recipientDeviceId,
        auth.deviceId,
        envelope
      );

      this.sendToDevice(recipientDeviceId, "message.envelope", envelope);

      const recipientSession = this.sessionsByDevice.get(recipientDeviceId);
      if (recipientSession) {
        await this.services.queueService.markDelivered(
          recipientDeviceId,
          envelope.envelopeId
        );
      }

      await this.services.pushService.notifyNewGhostMessage(
        recipientDeviceId,
        envelope.conversationId
      );
    }

    this.send(ws, "message.ack", {
      envelopeId: envelope.envelopeId,
      status: "queued",
      recipients: recipientDeviceIds.length
    });
  }

  private async flushQueue(deviceId: string, ws: WebSocket): Promise<void> {
    const pending = await this.services.queueService.getPendingForDevice(deviceId);

    for (const envelope of pending) {
      this.send(ws, "message.envelope", envelope);
      await this.services.queueService.markDelivered(deviceId, envelope.envelopeId);
    }

    this.send(ws, "queue.sync", {
      pendingCount: pending.length
    });
  }

  private send(ws: WebSocket, event: string, data: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        event,
        data
      })
    );
  }
}

function extractAccessToken(rawUrl: string): string | null {
  const url = new URL(rawUrl, "http://localhost");
  const token = url.searchParams.get("accessToken");
  return token && token.length > 0 ? token : null;
}
