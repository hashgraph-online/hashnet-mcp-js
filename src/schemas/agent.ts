import { z } from 'zod';
import type { AgentRegistrationRequest } from '@hashgraphonline/standards-sdk/dist/es/services/registry-broker/types.js';

const socialLinkSchema = z.object({
  platform: z.string(),
  handle: z.string(),
});

const aiAgentSchema = z.object({
  type: z.union([z.literal(0), z.literal(1)]),
  capabilities: z.array(z.number().int().nonnegative()),
  model: z.string(),
  creator: z.string().optional(),
});

const mcpServerSchema = z.object({
  version: z.string(),
  connectionInfo: z.object({
    url: z.string().url(),
    transport: z.enum(['stdio', 'sse']),
  }),
  services: z.array(z.number().int().nonnegative()),
  description: z.string(),
  capabilities: z.array(z.string()).optional(),
  resources: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  maintainer: z.string().optional(),
  repository: z.string().optional(),
  docs: z.string().optional(),
});

const baseProfileSchema = z.object({
  version: z.string(),
  type: z.number().int(),
  display_name: z.string(),
  alias: z.string().optional(),
  bio: z.string().optional(),
  socials: z.array(socialLinkSchema).optional(),
  profileImage: z.string().optional(),
  uaid: z.string().optional(),
  properties: z.record(z.any()).optional(),
  inboundTopicId: z.string().optional(),
  outboundTopicId: z.string().optional(),
  base_account: z.string().optional(),
});

export const agentProfileSchema = baseProfileSchema.extend({
  aiAgent: aiAgentSchema.optional(),
  mcpServer: mcpServerSchema.optional(),
});

const metadataSchema = z.object({
  trustScore: z.number().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  avgLatency: z.number().nonnegative().optional(),
  uptime: z.number().min(0).max(100).optional(),
  provider: z.string().optional(),
  category: z.string().optional(),
  adapter: z.string().optional(),
  openConvAICompatible: z.boolean().optional(),
  customFields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const agentRegistrationSchema: z.ZodType<AgentRegistrationRequest> = z.object({
  profile: agentProfileSchema,
  endpoint: z.string().url().optional(),
  protocol: z.string().optional(),
  communicationProtocol: z.string().optional(),
  registry: z.string().optional(),
  additionalRegistries: z.array(z.string()).optional(),
  metadata: metadataSchema.optional(),
});
