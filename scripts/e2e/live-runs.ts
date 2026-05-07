import { setTimeout as sleep } from "node:timers/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
  };
}

const protocolVersion = "2025-06-18";

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ response: Response; payload: JsonRpcResponse }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  let payload: JsonRpcResponse;
  if (contentType.includes("application/json")) {
    payload = JSON.parse(raw) as JsonRpcResponse;
  } else if (contentType.includes("text/event-stream") || raw.includes("event:")) {
    const dataLine = raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));

    if (!dataLine) {
      throw new Error(`No SSE data line found in response: ${raw}`);
    }

    payload = JSON.parse(dataLine.replace(/^data:\s*/, "")) as JsonRpcResponse;
  } else {
    throw new Error(`Unexpected response content-type=${contentType} body=${raw}`);
  }

  return { response, payload };
}

function extractToolResult(payload: JsonRpcResponse, label: string): Record<string, unknown> {
  if (payload.error) {
    throw new Error(`${label} failed with JSON-RPC error ${payload.error.code}: ${payload.error.message}`);
  }

  if (payload.result?.isError) {
    const message = payload.result.content?.map((item) => item.text ?? "").join("\n") ?? "unknown tool error";
    throw new Error(`${label} returned tool error: ${message}`);
  }

  const envelope = payload.result?.structuredContent as
    | {
        ok?: boolean;
        data?: Record<string, unknown>;
      }
    | undefined;

  if (!envelope?.ok || !envelope.data) {
    throw new Error(`${label} returned no structured success data`);
  }

  return envelope.data;
}

function readPath(value: unknown, pathSegments: string[]): unknown {
  let cursor: unknown = value;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

async function run(): Promise<void> {
  const port = Number(process.env.LIVE_RUN_HTTP_PORT ?? process.env.MCP_PORT ?? 3345);
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const baseUrl = `http://${host}:${port}/mcp`;
  const tsxBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );

  const server = spawn(tsxBin, ["src/index.ts"], {
    env: {
      ...process.env,
      MCP_TRANSPORT: "http",
      MCP_HOST: host,
      MCP_PORT: String(port),
      FEATURE_LEGACY_SSE: process.env.FEATURE_LEGACY_SSE ?? "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let stderrTail = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-5000);
  });

  try {
    let sessionId: string | undefined;

    for (let attempt = 1; attempt <= 40; attempt += 1) {
      try {
        const initResponse = await postJson(
          baseUrl,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion,
              capabilities: { tools: {}, logging: {} },
              clientInfo: { name: "live-runs", version: "0.1.0" },
            },
          },
          {
            "mcp-protocol-version": protocolVersion,
          },
        );

        if (initResponse.payload.error) {
          throw new Error(
            `initialize JSON-RPC error ${initResponse.payload.error.code}: ${initResponse.payload.error.message}`,
          );
        }

        sessionId = initResponse.response.headers.get("mcp-session-id") ?? undefined;
        if (!sessionId) {
          throw new Error("missing mcp-session-id from initialize response");
        }
        break;
      } catch {
        await sleep(250);
      }
    }

    if (!sessionId) {
      throw new Error(`HTTP server did not become ready. stderr tail:\n${stderrTail}`);
    }

    const callHeaders = {
      "mcp-session-id": sessionId,
      "mcp-protocol-version": protocolVersion,
    };

    const callTool = async (
      id: number,
      name: string,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const response = await postJson(
        baseUrl,
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name,
            arguments: args,
          },
        },
        callHeaders,
      );
      return extractToolResult(response.payload, name);
    };

    process.stdout.write("1) hol.search live run...\n");
    const searchResult = await callTool(2, "hol.search", {
      query: "customer support",
      limit: 10,
      type: "ai-agents",
    });

    const hits = readPath(searchResult, ["results", "hits"]);
    if (!Array.isArray(hits) || hits.length === 0) {
      throw new Error("hol.search succeeded but returned no hits");
    }

    const firstHit = hits[0] as Record<string, unknown>;
    const targetUaid = typeof firstHit.uaid === "string" ? firstHit.uaid : undefined;
    if (!targetUaid) {
      throw new Error("first search hit has no UAID");
    }
    process.stdout.write(`   selected UAID: ${targetUaid}\n`);

    process.stdout.write("2) hol.chat.createSession live run...\n");
    const sessionIdempotencyKey = `live-run-session-${Date.now()}`;
    const createdSession = await callTool(3, "hol.chat.createSession", {
      uaid: targetUaid,
      idempotencyKey: sessionIdempotencyKey,
    });

    const chatSessionId = readPath(createdSession, ["session", "sessionId"]);
    if (typeof chatSessionId !== "string" || chatSessionId.length === 0) {
      throw new Error("hol.chat.createSession succeeded but no sessionId in output");
    }
    process.stdout.write(`   chat sessionId: ${chatSessionId}\n`);

    const duplicateSession = await callTool(4, "hol.chat.createSession", {
      uaid: targetUaid,
      idempotencyKey: sessionIdempotencyKey,
    });
    const duplicateChatSessionId = readPath(duplicateSession, ["session", "sessionId"]);
    if (duplicateChatSessionId !== chatSessionId) {
      throw new Error("hol.chat.createSession idempotency did not return the same sessionId");
    }

    process.stdout.write("3) hol.chat.readiness live run...\n");
    const readiness = await callTool(5, "hol.chat.readiness", {
      uaid: targetUaid,
      forceRefresh: true,
    });
    process.stdout.write(`   readiness response keys: ${Object.keys(readiness).join(", ")}\n`);

    process.stdout.write("4) hol.chat.sendMessage live run...\n");
    const sentMessage = await callTool(6, "hol.chat.sendMessage", {
      sessionId: chatSessionId,
      message: "Live run validation ping from HOL MCP server POC.",
      idempotencyKey: `live-run-message-${Date.now()}`,
    });
    process.stdout.write(`   send response keys: ${Object.keys(sentMessage).join(", ")}\n`);

    process.stdout.write("5) hol.chat.history live run...\n");
    const history = await callTool(7, "hol.chat.history", {
      sessionId: chatSessionId,
    });
    process.stdout.write(`   history response keys: ${Object.keys(history).join(", ")}\n`);

    process.stdout.write("6) hol.chat.resume live run...\n");
    const resumed = await callTool(8, "hol.chat.resume", {
      sessionId: chatSessionId,
    });
    process.stdout.write(`   resume response keys: ${Object.keys(resumed).join(", ")}\n`);

    process.stdout.write("7) hol.chat.end live run...\n");
    await callTool(9, "hol.chat.end", {
      sessionId: chatSessionId,
    });
    process.stdout.write("   session ended\n");

    process.stdout.write("8) hol.getRegistrationQuote live run...\n");
    const profile =
      (typeof firstHit.profile === "object" && firstHit.profile !== null
        ? (firstHit.profile as Record<string, unknown>)
        : {
            name: `HOL MCP Live Run ${Date.now()}`,
            description: "Live run validation profile",
            capabilities: ["messaging"],
          }) satisfies Record<string, unknown>;

    const quoteArgs: Record<string, unknown> = {
      profile,
      endpoint:
        (typeof firstHit.endpoint === "string" && firstHit.endpoint) ||
        (typeof firstHit.url === "string" && firstHit.url) ||
        "https://example.com/agent",
      protocol: "mcp",
    };

    const quote = await callTool(10, "hol.getRegistrationQuote", quoteArgs);
    process.stdout.write(`   quote response keys: ${Object.keys(quote).join(", ")}\n`);

    process.stdout.write("LIVE RUNS PASSED\n");
  } finally {
    terminateProcessTree(server);
    await sleep(500);
    terminateProcessTree(server);
    await sleep(200);
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
