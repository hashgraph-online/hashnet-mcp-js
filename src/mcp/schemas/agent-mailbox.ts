import * as z from "zod/v4";

import { jsonRecordSchema, successEnvelopeSchema } from "./common.js";

/**
 * Agent-mailbox tool schemas. Bot-plane tools take the bot's `hol_agt_`
 * grant bearer token per call — the token is the request-scoped caller
 * identity and is never derived from server env credentials.
 */

const grantTokenSchema = z
  .string()
  .min(1)
  .describe("The bot's hol_agt_ grant bearer token issued at pairing time");

const leaseRefSchema = z.object({
  leaseId: z.string().min(1),
  fencingToken: z.number().int().positive(),
});

export const holAgentPairingCompleteInputSchema = z.object({
  pairingCode: z.string().min(1).describe("Short-lived hol_pair_ code shown to the bot owner"),
});
export const holAgentPairingCompleteOutputSchema = successEnvelopeSchema(
  z.object({
    grantId: z.string(),
    runtimeId: z.string(),
    token: z.string(),
    scopes: z.array(z.string()),
  }),
);

export const holAgentMeInputSchema = z.object({ grantToken: grantTokenSchema });
export const holAgentMeOutputSchema = successEnvelopeSchema(
  z.object({ runtime: jsonRecordSchema }),
);

export const holAgentInboxListInputSchema = z.object({
  grantToken: grantTokenSchema,
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  includeAcknowledged: z.boolean().optional(),
});
export const holAgentInboxListOutputSchema = successEnvelopeSchema(
  z.object({
    items: z.array(jsonRecordSchema),
    nextCursor: z.string().nullable(),
  }),
);

export const holAgentInboxClaimInputSchema = z.object({
  grantToken: grantTokenSchema,
});
export const holAgentInboxClaimOutputSchema = successEnvelopeSchema(
  z.object({ claim: jsonRecordSchema.nullable() }),
);

export const holAgentInboxAckInputSchema = z.object({
  grantToken: grantTokenSchema,
  messageId: z.string().min(1),
  leaseId: z.string().min(1),
  fencingToken: z.number().int().positive(),
});
export const holAgentInboxAckOutputSchema = successEnvelopeSchema(
  z.object({ message: jsonRecordSchema }),
);

export const holAgentInboxRenewLeaseInputSchema = leaseRefSchema.extend({
  grantToken: grantTokenSchema,
  messageId: z.string().min(1),
  extendSeconds: z.number().int().positive().max(3600).optional(),
});
export const holAgentInboxRenewLeaseOutputSchema = successEnvelopeSchema(
  z.object({ lease: jsonRecordSchema }),
);

export const holAgentSendInputSchema = z.object({
  grantToken: grantTokenSchema,
  recipientUaid: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  kind: z.enum(["request", "event"]).default("request"),
  text: z.string().min(1),
  expiresInSeconds: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).describe("Caller-generated dedupe key — required"),
});
export const holAgentSendOutputSchema = successEnvelopeSchema(
  z.object({ accepted: jsonRecordSchema }),
);

export const holAgentReplyInputSchema = leaseRefSchema.extend({
  grantToken: grantTokenSchema,
  messageId: z.string().min(1),
  text: z.string().min(1),
  outcome: z.enum(["answered", "failed", "refused", "canceled"]),
  idempotencyKey: z.string().min(1),
});
export const holAgentReplyOutputSchema = successEnvelopeSchema(
  z.object({
    request: jsonRecordSchema,
    response: jsonRecordSchema,
  }),
);

export const holAgentRejectInputSchema = leaseRefSchema.extend({
  grantToken: grantTokenSchema,
  messageId: z.string().min(1),
  reason: z.string().optional(),
});
export const holAgentRejectOutputSchema = successEnvelopeSchema(
  z.object({ message: jsonRecordSchema }),
);

export const holAgentMessageGetInputSchema = z.object({
  grantToken: grantTokenSchema,
  messageId: z.string().min(1),
});
export const holAgentMessageGetOutputSchema = successEnvelopeSchema(
  z.object({ message: jsonRecordSchema }),
);

export const holAgentConversationGetInputSchema = z.object({
  grantToken: grantTokenSchema,
  conversationId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export const holAgentConversationGetOutputSchema = successEnvelopeSchema(
  z.object({ conversation: jsonRecordSchema }),
);

export const holAgentConversationCancelInputSchema = z.object({
  grantToken: grantTokenSchema,
  conversationId: z.string().min(1),
});
export const holAgentConversationCancelOutputSchema = successEnvelopeSchema(
  z.object({
    conversationId: z.string(),
    canceledMessages: z.number(),
  }),
);
