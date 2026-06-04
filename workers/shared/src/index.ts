import { createServer, type Server } from 'node:http';
import { ApplicationFailure } from '@temporalio/activity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import Anthropic from '@anthropic-ai/sdk';
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

export interface AuditEntry {
  timestamp: string;
  workflowId: string;
  activityName: string;
  agent: string;
  eventType: 'mcp_call' | 'llm_call';
  tool: string;
  inputSummary: string;
  outputSummary: string;
}

export function summarize(value: unknown, maxLength = 300): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > maxLength ? `${s.slice(0, maxLength)}…` : s;
}

export function auditLog(entry: AuditEntry): void {
  console.log(JSON.stringify(entry));
}

export type AuditContext = { workflowId: string; activityName: string };

export async function callMcpTool(
  workerName: string,
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  auditCtx?: AuditContext,
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
    const resultText = result.content.find((c) => c.type === 'text')?.text ?? '';
    if (auditCtx) {
      auditLog({
        timestamp: new Date().toISOString(),
        workflowId: auditCtx.workflowId,
        activityName: auditCtx.activityName,
        agent: workerName,
        eventType: 'mcp_call',
        tool: toolName,
        inputSummary: summarize(args),
        outputSummary: summarize(resultText),
      });
    }
    return resultText;
  } finally {
    await client.close();
  }
}

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw ApplicationFailure.nonRetryable('ANTHROPIC_API_KEY is not set', 'MissingConfigError');
  }
  return new Anthropic({ apiKey });
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
