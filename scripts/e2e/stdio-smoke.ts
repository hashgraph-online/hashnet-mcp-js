import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

type JsonRpcEnvelope = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: {
    isError?: boolean;
    structuredContent?: {
      ok?: boolean;
    };
  } & Record<string, unknown>;
  error?: { code: number; message: string };
};

function paidToolAuthAvailable(envelope: JsonRpcEnvelope): boolean {
  const structuredContent = envelope.result?.structuredContent as
    | {
        data?: {
          auth?: {
            paidToolAuthAvailable?: boolean;
          };
        };
      }
    | undefined;

  return structuredContent?.data?.auth?.paidToolAuthAvailable === true;
}

const requestTimeoutMs = Number(process.env.SMOKE_STDIO_TIMEOUT_MS ?? 75_000);

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

async function run(): Promise<void> {
  const tsxBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );

  const server = spawn(tsxBin, ["src/index.ts"], {
    env: {
      ...process.env,
      MCP_TRANSPORT: "stdio",
    },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let stderrTail = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });

  const pending = new Map<number, { resolve: (value: JsonRpcEnvelope) => void; reject: (err: Error) => void }>();
  let nextId = 1;
  let stdoutBuffer = "";

  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      let parsed: JsonRpcEnvelope;
      try {
        parsed = JSON.parse(line) as JsonRpcEnvelope;
      } catch (error) {
        for (const request of pending.values()) {
          request.reject(new Error(`failed to parse server JSON line: ${line}`));
        }
        pending.clear();
        throw error;
      }

      if (typeof parsed.id === "number" && pending.has(parsed.id)) {
        const request = pending.get(parsed.id)!;
        pending.delete(parsed.id);
        request.resolve(parsed);
      }
    }
  });

  function sendRequest(method: string, params: Record<string, unknown>): Promise<JsonRpcEnvelope> {
    const id = nextId;
    nextId += 1;

    const message: JsonRpcEnvelope = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    server.stdin.write(`${JSON.stringify(message)}\n`);

    return new Promise<JsonRpcEnvelope>((resolve, reject) => {
      pending.set(id, { resolve, reject });

      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`request timeout for ${method} (id=${id})`));
        }
      }, requestTimeoutMs);
    });
  }

  function assertOk(envelope: JsonRpcEnvelope, label: string): void {
    if (envelope.error) {
      throw new Error(`${label} failed with JSON-RPC error ${envelope.error.code}: ${envelope.error.message}`);
    }

    if (envelope.result?.isError === true || envelope.result?.structuredContent?.ok === false) {
      throw new Error(`${label} returned MCP tool error`);
    }
  }

  try {
    await sleep(250);

    const initialize = await sendRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, logging: {} },
      clientInfo: { name: "smoke-stdio", version: "0.1.0" },
    });
    assertOk(initialize, "initialize");

    const toolsList = await sendRequest("tools/list", {});
    assertOk(toolsList, "tools/list");

    const capabilities = await sendRequest("tools/call", {
      name: "hol.capabilities",
      arguments: {},
    });
    assertOk(capabilities, "tools/call hol.capabilities");

    const stats = await sendRequest("tools/call", {
      name: "hol.stats",
      arguments: {},
    });
    assertOk(stats, "tools/call hol.stats");

    const search = await sendRequest("tools/call", {
      name: "hol.search",
      arguments: {
        query: "customer support",
        limit: 5,
        type: "ai-agents",
      },
    });
    assertOk(search, "tools/call hol.search");

    if (paidToolAuthAvailable(capabilities)) {
      const delegate = await sendRequest("tools/call", {
        name: "workflow.delegate",
        arguments: {
          task: "Summarize the strongest candidate for customer support automation.",
          query: "customer support automation specialist",
          limit: 2,
        },
      });
      assertOk(delegate, "tools/call workflow.delegate");
    }

    process.stdout.write("stdio smoke passed\n");
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nServer stderr tail:\n${stderrTail}`,
      { cause: error },
    );
  } finally {
    for (const request of pending.values()) {
      request.reject(new Error("stdio server terminated"));
    }
    pending.clear();

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
