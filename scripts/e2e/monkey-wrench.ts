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

interface ToolSuccessEnvelope {
  ok?: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

interface ToolOutcome {
  tool: string;
  status: "passed" | "failed" | "skipped";
  details: string;
  data?: Record<string, unknown>;
}

const protocolVersion = "2025-06-18";
const maxCredits = Number(process.env.MCP_MONKEY_MAX_CREDITS ?? 100);
const registrationSafetyBuffer = 10;

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

function findFirstNumberByKeys(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const found = findFirstNumberByKeys(nestedValue, keys);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function findFirstStringByKeys(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const found = findFirstStringByKeys(nestedValue, keys);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function createRegistrationPayload(
  firstHit: Record<string, unknown> | undefined,
  suffix: string,
): Record<string, unknown> {
  const fallbackName = `HOL MCP Monkey Wrench ${suffix}`;
  const endpoint = `https://example.com/hol-mcp-monkey-wrench/${suffix}`;
  const sourceProfile =
    typeof firstHit?.profile === "object" && firstHit.profile !== null
      ? cloneJsonRecord(firstHit.profile as Record<string, unknown>)
      : {
          name: fallbackName,
          display_name: fallbackName,
          bio: "Monkey wrench validation profile for HOL MCP server.",
          version: "1.0.0",
          capabilities: ["messaging", "discovery"],
        };

  sourceProfile.name = fallbackName;
  sourceProfile.display_name = fallbackName;
  sourceProfile.bio =
    typeof sourceProfile.bio === "string" && sourceProfile.bio.length > 0
      ? `${sourceProfile.bio} [monkey-wrench validation]`
      : "Monkey wrench validation profile for HOL MCP server.";
  sourceProfile.version = typeof sourceProfile.version === "string" ? sourceProfile.version : "1.0.0";

  return {
    profile: sourceProfile,
    endpoint,
    protocol: "mcp",
  };
}

async function callTool(
  baseUrl: string,
  callHeaders: Record<string, string>,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  try {
    const { payload } = await postJson(
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

    if (payload.error) {
      return {
        tool: name,
        status: "failed",
        details: `JSON-RPC ${payload.error.code}: ${payload.error.message}`,
      };
    }

    if (payload.result?.isError) {
      const message = payload.result.content?.map((item) => item.text ?? "").join("\n") ?? "unknown tool error";
      return {
        tool: name,
        status: "failed",
        details: message,
        data: payload.result.structuredContent,
      };
    }

    const envelope = payload.result?.structuredContent as ToolSuccessEnvelope | undefined;
    if (!envelope?.ok || !envelope.data) {
      return {
        tool: name,
        status: "failed",
        details: "missing structured success envelope",
        data: payload.result?.structuredContent,
      };
    }

    return {
      tool: name,
      status: "passed",
      details: typeof envelope.meta?.summary === "string" ? envelope.meta.summary : "ok",
      data: envelope.data,
    };
  } catch (error) {
    return {
      tool: name,
      status: "failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function run(): Promise<void> {
  const port = Number(process.env.MONKEY_HTTP_PORT ?? process.env.MCP_PORT ?? 3347);
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
    stderrTail = (stderrTail + chunk).slice(-10_000);
  });

  const outcomes: ToolOutcome[] = [];
  const knownCreditSignals: Array<{ tool: string; field: string; value: number }> = [];

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
              clientInfo: { name: "monkey-wrench", version: "0.1.0" },
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

    const toolsListResponse = await postJson(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      {
        "mcp-session-id": sessionId,
        "mcp-protocol-version": protocolVersion,
      },
    );

    if (toolsListResponse.payload.error) {
      throw new Error(
        `tools/list JSON-RPC error ${toolsListResponse.payload.error.code}: ${toolsListResponse.payload.error.message}`,
      );
    }

    const listedTools =
      ((toolsListResponse.payload.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? []);
    const expectedTools = [
      "hol.stats",
      "hol.capabilities",
      "hol.search",
      "hol.vectorSearch",
      "hol.resolveUaid",
      "hol.chat.createSession",
      "hol.chat.sendMessage",
      "hol.chat.history",
      "hol.chat.end",
      "hol.getRegistrationQuote",
      "hol.registerAgent",
      "hol.waitForRegistrationCompletion",
      "workflow.discovery",
      "workflow.registration",
    ];

    const missingTools = expectedTools.filter((tool) => !listedTools.some((listed) => listed.name === tool));
    if (missingTools.length > 0) {
      throw new Error(`tools/list missing expected tools: ${missingTools.join(", ")}`);
    }

    process.stdout.write(`Initialized MCP session ${sessionId}\n`);
    process.stdout.write(`Server exposed ${listedTools.length} tools\n`);

    const callHeaders = {
      "mcp-session-id": sessionId,
      "mcp-protocol-version": protocolVersion,
    };

    const capabilities = await callTool(baseUrl, callHeaders, 3, "hol.capabilities", {});
    outcomes.push(capabilities);

    const stats = await callTool(baseUrl, callHeaders, 4, "hol.stats", {});
    outcomes.push(stats);

    const search = await callTool(baseUrl, callHeaders, 5, "hol.search", {
      query: "customer support",
      limit: 5,
      type: "ai-agents",
    });
    outcomes.push(search);

    const vectorSearch = await callTool(baseUrl, callHeaders, 6, "hol.vectorSearch", {
      query: "customer support automation",
      limit: 3,
    });
    outcomes.push(vectorSearch);

    const workflowDiscovery = await callTool(baseUrl, callHeaders, 7, "workflow.discovery", {
      query: "customer support",
      limit: 3,
      filters: {
        type: "ai-agents",
      },
    });
    outcomes.push(workflowDiscovery);

    const hits = readPath(search.data, ["results", "hits"]);
    const firstHit = Array.isArray(hits) && hits.length > 0 ? (hits[0] as Record<string, unknown>) : undefined;
    const targetUaid =
      findFirstStringByKeys(firstHit ?? workflowDiscovery.data, ["uaid"]) ??
      findFirstStringByKeys(workflowDiscovery.data, ["uaid"]);

    if (!targetUaid) {
      throw new Error("Unable to identify a target UAID from search results");
    }

    const resolveUaid = await callTool(baseUrl, callHeaders, 8, "hol.resolveUaid", {
      uaid: targetUaid,
    });
    outcomes.push(resolveUaid);

    const registrationPayload = createRegistrationPayload(firstHit, `${Date.now()}`);
    const quote = await callTool(baseUrl, callHeaders, 9, "hol.getRegistrationQuote", registrationPayload);
    outcomes.push(quote);

    const requiredCredits = findFirstNumberByKeys(quote.data, ["requiredCredits", "credits", "quoteCredits"]);
    const availableCredits = findFirstNumberByKeys(quote.data, ["availableCredits"]);

    if (requiredCredits !== undefined) {
      knownCreditSignals.push({ tool: "hol.getRegistrationQuote", field: "requiredCredits", value: requiredCredits });
    }

    const maxRegistrationSpend = maxCredits - registrationSafetyBuffer;
    const canAttemptRegistrations =
      requiredCredits !== undefined &&
      requiredCredits * 2 <= maxRegistrationSpend &&
      (availableCredits === undefined || availableCredits >= requiredCredits * 2);

    if (!canAttemptRegistrations) {
      const reason =
        requiredCredits === undefined
          ? "quote did not include a machine-readable credit requirement"
          : `requiredCredits=${requiredCredits} makes two registration attempts exceed the safe budget`;

      outcomes.push({
        tool: "hol.chat.createSession",
        status: "skipped",
        details: `Skipped paid chat flow because registration budget guard failed: ${reason}`,
      });
      outcomes.push({
        tool: "hol.chat.sendMessage",
        status: "skipped",
        details: `Skipped paid chat flow because registration budget guard failed: ${reason}`,
      });
      outcomes.push({
        tool: "hol.chat.history",
        status: "skipped",
        details: `Skipped paid chat flow because registration budget guard failed: ${reason}`,
      });
      outcomes.push({
        tool: "hol.chat.end",
        status: "skipped",
        details: `Skipped paid chat flow because registration budget guard failed: ${reason}`,
      });
      outcomes.push({
        tool: "hol.registerAgent",
        status: "skipped",
        details: reason,
      });
      outcomes.push({
        tool: "hol.waitForRegistrationCompletion",
        status: "skipped",
        details: reason,
      });
      outcomes.push({
        tool: "workflow.registration",
        status: "skipped",
        details: reason,
      });
    } else {
      const chatCreate = await callTool(baseUrl, callHeaders, 10, "hol.chat.createSession", {
        uaid: targetUaid,
      });
      outcomes.push(chatCreate);

      const sessionIdForChat = findFirstStringByKeys(chatCreate.data, ["sessionId"]);
      if (!sessionIdForChat) {
        outcomes.push({
          tool: "hol.chat.sendMessage",
          status: "skipped",
          details: "No sessionId returned from hol.chat.createSession",
        });
        outcomes.push({
          tool: "hol.chat.history",
          status: "skipped",
          details: "No sessionId returned from hol.chat.createSession",
        });
        outcomes.push({
          tool: "hol.chat.end",
          status: "skipped",
          details: "No sessionId returned from hol.chat.createSession",
        });
      } else {
        const chatSend = await callTool(baseUrl, callHeaders, 11, "hol.chat.sendMessage", {
          sessionId: sessionIdForChat,
          message:
            "This is a live monkey wrench validation from the HOL MCP server. Reply with one short sentence describing your purpose.",
        });
        outcomes.push(chatSend);

        const chatCredits = findFirstNumberByKeys(chatSend.data, ["creditsCharged", "credits"]);
        if (chatCredits !== undefined) {
          knownCreditSignals.push({ tool: "hol.chat.sendMessage", field: "creditsCharged", value: chatCredits });
        }

        const chatHistory = await callTool(baseUrl, callHeaders, 12, "hol.chat.history", {
          sessionId: sessionIdForChat,
        });
        outcomes.push(chatHistory);

        const chatEnd = await callTool(baseUrl, callHeaders, 13, "hol.chat.end", {
          sessionId: sessionIdForChat,
        });
        outcomes.push(chatEnd);
      }

      const register = await callTool(baseUrl, callHeaders, 14, "hol.registerAgent", registrationPayload);
      outcomes.push(register);

      const registrationCredits = findFirstNumberByKeys(register.data, ["creditsCharged", "credits"]);
      if (registrationCredits !== undefined) {
        knownCreditSignals.push({ tool: "hol.registerAgent", field: "creditsCharged", value: registrationCredits });
      }

      const attemptId = findFirstStringByKeys(register.data, ["attemptId"]);
      if (!attemptId) {
        outcomes.push({
          tool: "hol.waitForRegistrationCompletion",
          status: "skipped",
          details: "registerAgent did not return an attemptId",
        });
      } else {
        const wait = await callTool(baseUrl, callHeaders, 15, "hol.waitForRegistrationCompletion", {
          attemptId,
          timeoutMs: 120000,
          pollIntervalMs: 3000,
        });
        outcomes.push(wait);
      }

      const workflowPayload = createRegistrationPayload(firstHit, `${Date.now()}-workflow`);
      const workflowRegistration = await callTool(baseUrl, callHeaders, 16, "workflow.registration", {
        payload: workflowPayload,
        wait: true,
        timeoutMs: 120000,
        pollIntervalMs: 3000,
      });
      outcomes.push(workflowRegistration);

      const workflowCredits = findFirstNumberByKeys(workflowRegistration.data, [
        "creditsCharged",
        "credits",
        "quoteCredits",
      ]);
      if (workflowCredits !== undefined) {
        knownCreditSignals.push({
          tool: "workflow.registration",
          field: "quoteOrChargedCredits",
          value: workflowCredits,
        });
      }
    }

    const healthResponse = await fetch(`http://${host}:${port}/healthz`);
    const healthPayload = (await healthResponse.json()) as Record<string, unknown>;
    process.stdout.write(`healthz: ${JSON.stringify(healthPayload)}\n`);

    process.stdout.write("\nTool outcomes:\n");
    for (const outcome of outcomes) {
      process.stdout.write(`- ${outcome.tool}: ${outcome.status} :: ${outcome.details}\n`);
    }

    if (knownCreditSignals.length > 0) {
      process.stdout.write("\nObserved credit signals:\n");
      for (const signal of knownCreditSignals) {
        process.stdout.write(`- ${signal.tool}: ${signal.field}=${signal.value}\n`);
      }
    }

    const failedOrSkipped = outcomes.filter((outcome) => outcome.status !== "passed");
    if (failedOrSkipped.length > 0) {
      throw new Error(
        `Monkey wrench completed with non-passing outcomes for: ${failedOrSkipped
          .map((outcome) => outcome.tool)
          .join(", ")}`,
      );
    }

    process.stdout.write("\nMONKEY WRENCH PASSED\n");
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
