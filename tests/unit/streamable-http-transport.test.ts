import { describe, expect, test, vi } from "vitest";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

describe("streamable HTTP transport", () => {
  test("invokes the public onclose callback when the transport closes", async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => "test-session",
    });
    const onClose = vi.fn();

    transport.onclose = onClose;
    await transport.close();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
