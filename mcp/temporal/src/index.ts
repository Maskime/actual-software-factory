import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TemporalClient, TemporalConnectionError } from "./temporal-client.js";
import { buildMcpServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  const tc = new TemporalClient();

  try {
    await tc.connect();
  } catch (err) {
    if (err instanceof TemporalConnectionError) {
      process.stderr.write(`[mcp-temporal] Connection error: ${err.message}\n`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mcp-temporal] Startup error: ${msg}\n`);
    }
    process.exit(1);
  }

  try {
    await tc.validateConnection();
  } catch (err) {
    if (err instanceof TemporalConnectionError) {
      process.stderr.write(`[mcp-temporal] Validation error: ${err.message}\n`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mcp-temporal] Validation error: ${msg}\n`);
    }
    process.exit(1);
  }

  const app = createMcpExpressApp();

  app.post("/mcp", async (req, res) => {
    const server = buildMcpServer(tc);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mcp-temporal] Request error: ${msg}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  app.listen(PORT, () => {
    process.stderr.write(`[mcp-temporal] HTTP on :${PORT} (namespace="${tc.namespace}", address="${tc.address}")\n`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mcp-temporal] Fatal error: ${message}\n`);
  process.exit(1);
});
