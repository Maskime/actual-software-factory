import { ApplicationFailure, log } from '@temporalio/activity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface FixCodeInput {
  issueIid: number;
  projectId: number;
  mrIid: number;
}

export interface BlockingFeedback {
  file: string | null;
  line: number | null;
  message: string;
}

const BLOQUANT_PREFIX = '[BLOQUANT]';

type McpContent = { type: string; text?: string };
type McpToolResult = { content: McpContent[]; isError?: boolean };

interface MrNotePosition {
  new_path?: string;
  old_path?: string;
  new_line?: number | null;
  old_line?: number | null;
}

interface MrNote {
  id: number;
  body: string;
  position?: MrNotePosition | null;
}

interface MrResponse {
  comments: MrNote[];
}

function fixConfig(): { mcpGitlabUrl: string } {
  return {
    mcpGitlabUrl: process.env.MCP_GITLAB_URL ?? 'http://mcp-gitlab:3000/mcp', // NOSONAR
  };
}

async function callMcpTool(
  mcpGitlabUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = new Client({ name: 'review-fix-worker', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpGitlabUrl));
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

async function fetchBlockingComments(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
): Promise<BlockingFeedback[]> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(projectId),
    mr_iid: mrIid,
  });

  const mr = JSON.parse(text || '{}') as MrResponse;
  const notes = mr.comments ?? [];

  return notes
    .filter((n) => n.body.startsWith(BLOQUANT_PREFIX))
    .map((n) => ({
      file: n.position?.new_path ?? n.position?.old_path ?? null,
      line: n.position?.new_line ?? n.position?.old_line ?? null,
      message: n.body.slice(BLOQUANT_PREFIX.length).trim(),
    }));
}

export async function fixCode(input: FixCodeInput): Promise<BlockingFeedback[]> {
  log.info('Fix-review agent starting', { mrIid: input.mrIid, projectId: input.projectId });
  const { mcpGitlabUrl } = fixConfig();
  const feedbacks = await fetchBlockingComments(mcpGitlabUrl, input.projectId, input.mrIid);
  log.info('Blocking comments fetched', { count: feedbacks.length, mrIid: input.mrIid });
  return feedbacks;
}
