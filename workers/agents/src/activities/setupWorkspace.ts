import { ApplicationFailure } from '@temporalio/activity';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentInput, IssueContext, WorkspaceContext } from '../types.js';

const execFileAsync = promisify(execFile);

function agentConfig(): { gitlabApiUrl: string; token: string; mcpGitlabUrl: string } {
  // NOSONAR — internal Docker hostnames; HTTP is intentional inside the factory network
  const gitlabApiUrl = process.env.GITLAB_API_INTERNAL_URL ?? 'http://gitlab/api/v4'; // NOSONAR
  const token = process.env.GITLAB_API_TOKEN;
  const mcpGitlabUrl = process.env.MCP_GITLAB_INTERNAL_URL ?? 'http://mcp-gitlab:3000/mcp'; // NOSONAR
  if (!token) {
    throw ApplicationFailure.nonRetryable('GITLAB_API_TOKEN is not set', 'MissingConfigError');
  }
  return { gitlabApiUrl, token, mcpGitlabUrl };
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } });
  if (res.status >= 400 && res.status < 500) {
    throw ApplicationFailure.nonRetryable(
      `GitLab API client error ${res.status} on GET ${url}`,
      'GitLabClientError'
    );
  }
  if (!res.ok) {
    throw new Error(`GitLab API server error ${res.status} on GET ${url}`);
  }
  return res.json() as Promise<T>;
}

async function readIssueViaMcp(
  mcpGitlabUrl: string,
  projectId: number,
  issueIid: number
): Promise<{ title: string; description: string }> {
  const client = new Client({ name: 'agent-worker', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpGitlabUrl));
  await client.connect(transport);
  try {
    type ToolContent = { type: string; text?: string };
    type ToolResult = { content: ToolContent[]; isError?: boolean };
    const result = (await client.callTool({
      name: 'gitlab_get_issue',
      arguments: { project_id: String(projectId), issue_iid: issueIid },
    })) as ToolResult;
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) {
      throw ApplicationFailure.nonRetryable(
        `MCP gitlab_get_issue returned error: ${text}`,
        'McpGitLabError'
      );
    }
    const data = JSON.parse(text) as { title: string; description: string };
    return { title: data.title, description: data.description ?? '' };
  } finally {
    await client.close();
  }
}

function extractAcceptanceCriteria(description: string): string[] {
  const lines = description.split('\n');
  let inSection = false;
  const criteria: string[] = [];
  for (const line of lines) {
    if (/crit.res d.acceptation/i.exec(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (line.startsWith('##')) break;
      const m = /^-\s+\[[ xX]\]\s*(.+)/.exec(line.trim());
      if (m) criteria.push(m[1].trim());
    }
  }
  return criteria;
}

export async function setupWorkspace(input: AgentInput): Promise<WorkspaceContext> {
  const { gitlabApiUrl, token, mcpGitlabUrl } = agentConfig();
  const workDir = `/tmp/factory/${input.workflowRunId}`;

  const project = await fetchJson<{ http_url_to_repo: string }>(
    `${gitlabApiUrl}/projects/${input.projectId}`,
    token
  );
  const cloneUrl = new URL(project.http_url_to_repo);
  cloneUrl.username = 'oauth2';
  cloneUrl.password = token;

  await execFileAsync('git', ['clone', '--depth=1', cloneUrl.toString(), workDir]);

  const { title, description } = await readIssueViaMcp(
    mcpGitlabUrl,
    input.projectId,
    input.issueIid
  );

  const issue: IssueContext = {
    title,
    description,
    acceptanceCriteria: extractAcceptanceCriteria(description),
  };

  return { workDir, issue };
}
