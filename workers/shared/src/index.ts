import { createServer, type Server } from 'node:http';
import { ApplicationFailure } from '@temporalio/activity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function createHealthServer(port: number): Server {
  return createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else {
      res.writeHead(404).end();
    }
  }).listen(port);
}

type McpContent = { type: string; text?: string };
type McpToolResult = { content: McpContent[]; isError?: boolean };

export async function callMcpTool(
  workerName: string,
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = new Client({ name: workerName, version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    const result = (await client.callTool({ name: toolName, arguments: args })) as McpToolResult;
    if (result.isError) {
      const text = result.content.find((c) => c.type === 'text')?.text ?? '';
      throw ApplicationFailure.nonRetryable(`${toolName} failed: ${text}`, 'McpToolError');
    }
    return result.content.find((c) => c.type === 'text')?.text ?? '';
  } finally {
    await client.close();
  }
}

export interface ReviewComment {
  file: string;
  line: number | null;
  description: string;
  classification: 'bloquant' | 'modéré' | 'esthétique';
}

export interface ReviewAgentOutput {
  comments: ReviewComment[];
  bloquant: number;
  modéré: number;
  esthétique: number;
  backlogIssueIids: number[];
}
