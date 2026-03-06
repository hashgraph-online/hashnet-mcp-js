import { setTimeout as sleep } from "node:timers/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
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

function assertJsonRpcOk(payload: JsonRpcResponse, label: string): void {
  if (payload.error) {
    throw new Error(`${label} failed with JSON-RPC error ${payload.error.code}: ${payload.error.message}`);
  }
}

async function run(): Promise<void> {
  const port = Number(process.env.SMOKE_HTTP_PORT ?? process.env.MCP_PORT ?? 3341);
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
    stderrTail = (stderrTail + chunk).slice(-4000);
  });

  try {
    let initialized:
      | {
          sessionId: string;
          payload: JsonRpcResponse;
        }
      | undefined;

    for (let attempt = 1; attempt <= 40; attempt += 1) {
      try {
        const initializeBody = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion,
            capabilities: { tools: {}, logging: {} },
            clientInfo: { name: "smoke-http", version: "0.1.0" },
          },
        };

        const { response, payload } = await postJson(baseUrl, initializeBody, {
          "mcp-protocol-version": protocolVersion,
        });

        assertJsonRpcOk(payload, "initialize");
        const sessionId = response.headers.get("mcp-session-id");
        if (!sessionId) {
          throw new Error("initialize succeeded but mcp-session-id header is missing");
        }

        initialized = { sessionId, payload };
        break;
      } catch {
        await sleep(250);
      }
    }

    if (!initialized) {
      throw new Error(`HTTP server did not become ready. Stderr tail:\n${stderrTail}`);
    }

    const callHeaders = {
      "mcp-session-id": initialized.sessionId,
      "mcp-protocol-version": protocolVersion,
    };

    const toolsListBody = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };
    const toolsList = await postJson(baseUrl, toolsListBody, callHeaders);
    assertJsonRpcOk(toolsList.payload, "tools/list");

    const statsBody = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "hol.stats",
        arguments: {},
      },
    };
    const stats = await postJson(baseUrl, statsBody, callHeaders);
    assertJsonRpcOk(stats.payload, "tools/call hol.stats");

    const searchBody = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "hol.search",
        arguments: {
          query: "customer support",
          limit: 5,
          type: "ai-agents",
        },
      },
    };
    const search = await postJson(baseUrl, searchBody, callHeaders);
    assertJsonRpcOk(search.payload, "tools/call hol.search");

    const vectorSearchBody = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "hol.vectorSearch",
        arguments: {
          query: "customer support automation",
          limit: 3,
        },
      },
    };
    const vectorSearch = await postJson(baseUrl, vectorSearchBody, callHeaders);
    assertJsonRpcOk(vectorSearch.payload, "tools/call hol.vectorSearch");

    process.stdout.write("HTTP smoke passed\n");
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
