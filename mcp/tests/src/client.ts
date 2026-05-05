import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export async function createMcpClient(url: string): Promise<Client> {
  const client = new Client({ name: "mcp-test-client", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ data: unknown; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const textContent = result.content.find((c) => c.type === "text");
  let data: unknown = null;
  if (textContent?.text) {
    try {
      data = JSON.parse(textContent.text);
    } catch {
      data = textContent.text;
    }
  }
  return { data, isError: result.isError === true };
}

export async function listTools(client: Client): Promise<string[]> {
  const result = await client.listTools();
  return result.tools.map((t) => t.name);
}
