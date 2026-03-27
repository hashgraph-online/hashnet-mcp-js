import * as z from "zod/v4";

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const jsonRecordSchema = z.record(z.string(), z.unknown());
export const emptyInputSchema = z.object({});
export const agentAuthConfigSchema = z.object({
  type: z.enum(["bearer", "basic", "header", "apiKey"]).optional(),
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  headerName: z.string().optional(),
  headerValue: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export const toolResultMetaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  summary: z.string(),
  traceId: z.string(),
  durationMs: z.number().int().nonnegative(),
  count: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).optional(),
});
export const toolErrorSchema = z.object({
  code: z.string(),
  category: z.enum([
    "auth",
    "validation",
    "not_found",
    "rate_limit",
    "timeout",
    "cancelled",
    "upstream",
    "internal",
    "capacity",
  ]),
  message: z.string(),
  retryable: z.boolean(),
  statusCode: z.number().int().positive().optional(),
  details: z.unknown().optional(),
});

export function successEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: toolResultMetaSchema,
  });
}

export const toolErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: toolErrorSchema,
  meta: toolResultMetaSchema.partial().extend({
    schemaVersion: z.number().int().positive(),
  }),
});

export const holStatsOutputSchema = successEnvelopeSchema(
  z.object({
    stats: jsonRecordSchema,
  }),
);

export const holSearchInputSchema = z.object({
  q: z.string().optional(),
  query: z.string().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  registry: z.string().optional(),
  registries: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  protocols: z.array(z.string()).optional(),
  adapters: z.array(z.string()).optional(),
  minTrust: z.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  type: z.string().optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  metadata: z.record(z.string(), z.array(metadataValueSchema)).optional(),
});

export const holVectorSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const holResolveUaidInputSchema = z.object({
  uaid: z.string().min(1),
});

export const holChatCreateSessionInputSchema = z.object({
  uaid: z.string().optional(),
  agentUrl: z.string().optional(),
  auth: agentAuthConfigSchema.optional(),
  senderUaid: z.string().optional(),
  historyTtlSeconds: z.number().int().positive().optional(),
  encryptionRequested: z.boolean().optional(),
});

export const holChatSendMessageInputSchema = z.object({
  sessionId: z.string().optional(),
  uaid: z.string().optional(),
  agentUrl: z.string().optional(),
  auth: agentAuthConfigSchema.optional(),
  senderUaid: z.string().optional(),
  historyTtlSeconds: z.number().int().positive().optional(),
  encryptionRequested: z.boolean().optional(),
  message: z.string().min(1),
  streaming: z.boolean().optional(),
});

export const holChatHistoryInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const holChatEndInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const registrationPayloadSchema = z.object({
  profile: jsonRecordSchema,
  endpoint: z.string().optional(),
  protocol: z.string().optional(),
  communicationProtocol: z.string().optional(),
  registry: z.string().optional(),
  additionalRegistries: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const waitRegistrationInputSchema = z.object({
  attemptId: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
});

export const workflowDiscoveryFiltersSchema = holSearchInputSchema.omit({
  q: true,
  query: true,
  limit: true,
}).strict();

export const workflowDiscoveryInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  filters: workflowDiscoveryFiltersSchema.optional(),
});

export const workflowRegistrationInputSchema = z.object({
  payload: registrationPayloadSchema,
  wait: z.boolean().default(true),
  timeoutMs: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
});

export const workflowDelegateInputSchema = z.object({
  task: z.string().min(1),
  query: z.string().optional(),
  uaid: z.string().optional(),
  agentUrl: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  filters: workflowDiscoveryFiltersSchema.optional(),
  auth: agentAuthConfigSchema.optional(),
  senderUaid: z.string().optional(),
  historyTtlSeconds: z.number().int().positive().optional(),
  encryptionRequested: z.boolean().optional(),
  streaming: z.boolean().optional(),
});

export const holSearchOutputSchema = successEnvelopeSchema(
  z.object({
    query: z.string(),
    count: z.number().int().nonnegative(),
    results: jsonRecordSchema,
  }),
);

export const holVectorSearchOutputSchema = successEnvelopeSchema(
  z.object({
    query: z.string(),
    count: z.number().int().nonnegative(),
    results: jsonRecordSchema,
  }),
);

export const holResolveUaidOutputSchema = successEnvelopeSchema(
  z.object({
    uaid: z.string(),
    resolved: jsonRecordSchema,
  }),
);

export const holChatCreateSessionOutputSchema = successEnvelopeSchema(
  z.object({
    session: jsonRecordSchema,
  }),
);

export const holChatSendMessageOutputSchema = successEnvelopeSchema(
  z.object({
    sessionId: z.string(),
    response: jsonRecordSchema,
  }),
);

export const holChatHistoryOutputSchema = successEnvelopeSchema(
  z.object({
    sessionId: z.string(),
    history: jsonRecordSchema,
  }),
);

export const holChatEndOutputSchema = successEnvelopeSchema(
  z.object({
    sessionId: z.string(),
    ended: z.boolean(),
  }),
);

export const holRegistrationQuoteOutputSchema = successEnvelopeSchema(
  z.object({
    quote: jsonRecordSchema,
  }),
);

export const holRegisterAgentOutputSchema = successEnvelopeSchema(
  z.object({
    registration: jsonRecordSchema,
  }),
);

export const holWaitRegistrationOutputSchema = successEnvelopeSchema(
  z.object({
    attemptId: z.string(),
    progress: z.unknown(),
  }),
);

export const workflowDiscoveryOutputSchema = successEnvelopeSchema(
  z.object({
    query: z.string(),
    totalHits: z.number().int().nonnegative(),
    topHits: z.array(
      z.object({
        uaid: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        registry: z.string().optional(),
      }),
    ),
    raw: jsonRecordSchema,
  }),
);

export const workflowRegistrationOutputSchema = successEnvelopeSchema(
  z.object({
    quote: jsonRecordSchema,
    registration: jsonRecordSchema,
    progress: z.unknown().optional(),
    waited: z.boolean(),
  }),
);

export const workflowDelegateOutputSchema = successEnvelopeSchema(
  z.object({
    task: z.string(),
    query: z.string(),
    candidateCount: z.number().int().nonnegative(),
    selectedAgent: z.object({
      uaid: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      registry: z.string().optional(),
      agentUrl: z.string().optional(),
      score: z.number().optional(),
    }),
    session: jsonRecordSchema,
    response: jsonRecordSchema,
    search: jsonRecordSchema.optional(),
  }),
);

export const holCapabilitiesOutputSchema = successEnvelopeSchema(
  z.object({
    server: z.object({
      name: z.string(),
      version: z.string(),
    }),
    transports: z.object({
      stdio: z.boolean(),
      http: z.boolean(),
      legacySse: z.boolean(),
    }),
    auth: z.object({
      brokerApiKeyConfigured: z.boolean(),
      ledgerAuthConfigured: z.boolean(),
      ledgerAuthMode: z.enum(["none", "hedera", "evm"]),
      paidToolAuthAvailable: z.boolean(),
      httpBearerRequired: z.boolean(),
    }),
    limits: z.object({
      brokerRateLimitConcurrency: z.number().int().positive(),
      brokerRateLimitMinTimeMs: z.number().int().positive(),
      brokerRequestTimeoutMs: z.number().int().positive(),
      sessionIdleTtlMs: z.number().int().positive(),
      sessionMaxCount: z.number().int().positive(),
    }),
    features: z.object({
      legacySse: z.boolean(),
      memorySqlite: z.boolean(),
      memoryRedis: z.boolean(),
      ledgerAuth: z.boolean(),
      encryptedChat: z.boolean(),
    }),
  }),
);
