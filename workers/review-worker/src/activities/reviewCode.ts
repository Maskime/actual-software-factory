import { ApplicationFailure, log } from '@temporalio/activity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ReviewCodeInput {
  mrIid: number;
  projectId: number;
  issueIid: number;
  branchName: string;
}

export interface MrFileChange {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export interface MrContext {
  title: string;
  description: string;
  diff: MrFileChange[];
}

type McpContent = { type: string; text?: string };
type McpToolResult = { content: McpContent[]; isError?: boolean };

function reviewConfig(): { mcpGitlabUrl: string } {
  return { mcpGitlabUrl: process.env.MCP_GITLAB_URL ?? 'http://mcp-gitlab:3000/mcp' }; // NOSONAR
}

async function callMcpTool(
  mcpGitlabUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = new Client({ name: 'review-worker', version: '0.1.0' });
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

async function readMrDiff(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
): Promise<MrFileChange[]> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr_diff', {
    project_id: String(projectId),
    mr_iid: mrIid,
  });
  return JSON.parse(text || '[]') as MrFileChange[];
}

async function readMrMetadata(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
): Promise<{ title: string; description: string }> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(projectId),
    mr_iid: mrIid,
  });
  const mr = JSON.parse(text || '{}') as { title: string; description: string };
  return { title: mr.title, description: mr.description ?? '' };
}

export async function reviewCode(input: ReviewCodeInput): Promise<void> {
  log.info('Review agent starting', {
    mrIid: input.mrIid,
    projectId: input.projectId,
    issueIid: input.issueIid,
    branchName: input.branchName,
  });

  const { mcpGitlabUrl } = reviewConfig();

  const [diff, metadata] = await Promise.all([
    readMrDiff(mcpGitlabUrl, input.projectId, input.mrIid),
    readMrMetadata(mcpGitlabUrl, input.projectId, input.mrIid),
  ]);

  if (diff.length === 0) {
    throw ApplicationFailure.nonRetryable(
      `MR !${input.mrIid} has an empty diff — nothing to review`,
      'EmptyDiffError',
    );
  }

  log.info('MR data loaded', {
    mrTitle: metadata.title,
    filesChanged: diff.length,
    linkedIssueIid: input.issueIid,
  });
}
