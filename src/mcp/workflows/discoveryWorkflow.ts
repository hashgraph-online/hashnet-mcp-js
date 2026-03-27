import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  workflowDiscoveryInputSchema,
  workflowDiscoveryOutputSchema,
} from "../schemas/common.js";
import { executeTool } from "../tools/execute.js";
import type { ToolRegisterContext } from "../tools/types.js";

export function registerDiscoveryWorkflow(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "workflow.discovery",
    {
      title: "Discovery Workflow",
      description: "Run normalized discovery and return top results with concise summaries",
      inputSchema: workflowDiscoveryInputSchema,
      outputSchema: workflowDiscoveryOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "workflow.discovery",
        run: async (traceId) => {
          const results = await ctx.withBroker(traceId, "search", (client) =>
            client.search({
              ...(args.filters ?? {}),
              q: args.query,
              limit: args.limit,
            }),
          );

          return {
            query: args.query,
            totalHits: Array.isArray(results.hits) ? results.hits.length : 0,
            topHits: (results.hits ?? []).slice(0, args.limit ?? 10).map((hit: Record<string, unknown>) => ({
              uaid: typeof hit.uaid === "string" ? hit.uaid : undefined,
              name: typeof hit.name === "string" ? hit.name : undefined,
              description: typeof hit.description === "string" ? hit.description : undefined,
              registry: typeof hit.registry === "string" ? hit.registry : undefined,
            })),
            raw: results,
          };
        },
        summary: (data) =>
          `Discovery workflow returned ${data.topHits.length} top hits from ${data.totalHits} total matches.`,
        count: (data) => data.totalHits,
      }),
  );
}
