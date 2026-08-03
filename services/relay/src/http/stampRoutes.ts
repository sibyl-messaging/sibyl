import {
  approveStampHelperClaimRequestSchema,
  attachStampHelperRequestSchema,
  createStampBundleRequestSchema,
  publishStampHelperEncapsulationRequestSchema,
  registerStampHelperRequestSchema,
  signedStampCiphertextMessageSchema,
  stampHelperCapabilityRequestSchema
} from "@sibyl/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ServiceContainer, WsHubLike } from "../types/services.js";
import { requireAuth } from "./authGuard.js";

const bundleParamsSchema = z
  .object({
    bundleId: z.string().min(1)
  })
  .strict();

const messageAckSchema = z
  .object({
    messageId: z.string().min(1)
  })
  .strict();

const claimParamsSchema = z
  .object({
    claimId: z.string().min(1)
  })
  .strict();

const activeBundleQuerySchema = z
  .object({
    conversationId: z.string().min(1)
  })
  .strict();

export async function registerStampRoutes(
  app: FastifyInstance,
  services: ServiceContainer,
  wsHub: WsHubLike
): Promise<void> {
  app.post("/v2/stamp-bundles", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const body = createStampBundleRequestSchema.parse(request.body);
    const recipientUserId =
      await services.conversationService.getActivePeerUserId(
        body.conversationId,
        auth.userId
      );
    const created = await services.stampService.createBundle({
      ...body,
      initiatorUserId: auth.userId,
      recipientUserId
    });
    wsHub.sendToUser(recipientUserId, "stamp.bundle.proposed", {
      descriptor: created.descriptor,
      helperSlots: created.recipientSlots
    });
    return reply.status(201).send({
      descriptor: created.descriptor,
      helperSlots: created.initiatorSlots
    });
  });

  app.get("/v2/stamp-bundles/active", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const query = activeBundleQuerySchema.parse(request.query);
    await services.conversationService.assertConversationActiveMember(
      query.conversationId,
      auth.userId
    );
    return {
      setup: await services.stampService.getActiveBundle(
        query.conversationId,
        auth.userId
      )
    };
  });

  app.get("/v2/stamp-bundles/:bundleId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const params = bundleParamsSchema.parse(request.params);
    return services.stampService.getBundle(params.bundleId, auth.userId);
  });

  app.post("/v2/stamp-helpers/register", async (request, reply) => {
    const body = registerStampHelperRequestSchema.parse(request.body);
    const registration = await services.stampService.registerHelper(body);
    return reply.status(201).send(registration);
  });

  app.post("/v2/stamp-helpers/attach", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const body = attachStampHelperRequestSchema.parse(request.body);
    return services.stampService.attachHelper(body, auth.userId);
  });

  app.get("/v2/stamp-helper-claims/:claimId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const params = claimParamsSchema.parse(request.params);
    return services.stampService.getAttachmentClaim(params.claimId, auth.userId);
  });

  app.post("/v2/stamp-helpers/approve", async (request) => {
    const body = approveStampHelperClaimRequestSchema.parse(request.body);
    const approved = await services.stampService.approveAttachmentClaim(body);
    const event = {
      descriptor: approved.bundle,
      pairId: approved.helper.pairId,
      shareIndex: approved.helper.shareIndex,
      pairState: approved.helper.state
    };
    wsHub.sendToUser(
      approved.bundle.initiatorUserId,
      "stamp.bundle.updated",
      event
    );
    wsHub.sendToUser(
      approved.bundle.recipientUserId,
      "stamp.bundle.updated",
      event
    );
    return approved.helper;
  });

  app.post("/v2/stamp-helpers/status", async (request) => {
    const body = stampHelperCapabilityRequestSchema.parse(request.body);
    return services.stampService.getHelperStatus(body);
  });

  app.post("/v2/stamp-helpers/encapsulation", async (request) => {
    const body = publishStampHelperEncapsulationRequestSchema.parse(request.body);
    return services.stampService.publishHpkeEncapsulation(body);
  });

  app.post("/v2/stamp-helpers/confirm", async (request) => {
    const body = stampHelperCapabilityRequestSchema.parse(request.body);
    const confirmed = await services.stampService.confirmHelper(body);
    const event = {
      descriptor: confirmed.bundle,
      pairId: confirmed.helper.pairId,
      shareIndex: confirmed.helper.shareIndex,
      pairState: confirmed.helper.state
    };
    wsHub.sendToUser(
      confirmed.bundle.initiatorUserId,
      "stamp.bundle.updated",
      event
    );
    wsHub.sendToUser(
      confirmed.bundle.recipientUserId,
      "stamp.bundle.updated",
      event
    );
    return confirmed.helper;
  });

  app.post("/v2/stamp-messages", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const message = signedStampCiphertextMessageSchema.parse(request.body);
    const signingPublicKey =
      await services.directoryService.getDeviceSigningPublicKey(
        auth.userId,
        auth.deviceId
      );
    const accepted = await services.stampService.acceptMessage(
      message,
      auth,
      signingPublicKey
    );
    wsHub.sendToUser(
      accepted.recipientUserId,
      "stamp.message",
      accepted
    );
    return reply.status(202).send({
      messageId: accepted.messageId,
      bundleId: accepted.bundleId,
      status: "accepted"
    });
  });

  app.get("/v2/stamp-messages", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    return {
      messages: await services.stampService.getPendingMessages(auth.userId)
    };
  });

  app.post("/v2/stamp-messages/ack", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const body = messageAckSchema.parse(request.body);
    await services.stampService.acknowledgeMessage(
      body.messageId,
      auth.userId
    );
    return { ok: true };
  });
}
