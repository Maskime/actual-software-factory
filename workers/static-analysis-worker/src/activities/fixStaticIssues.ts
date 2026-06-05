import { ApplicationFailure, activityInfo, log } from '@temporalio/activity';
import Anthropic from '@anthropic-ai/sdk';
import { callMcpTool, createAnthropicClient, auditLog, summarize, type AuditContext } from '@factory/worker-shared';
import { fetchSonarIssues, classifyIssue, type SonarIssue } from './staticAnalysisAgent.js';

export interface FixStaticInput {
  issueIid: number;
  projectId: number;
  mrIid: number;
  branchName: string;
}

export interface FixStaticOutput {
  fixed: number;
  skipped: number;
}

const WORKER_NAME = 'static-analysis-worker';

function fixStaticConfig(): {
  mcpGitlabUrl: string;
  mcpSonarqubeUrl: string;
  projectKey: string;
  anthropicModel: string;
} {
  const projectKey = process.env.SONARQUBE_PROJECT_KEY;
  if (!projectKey) {
    throw ApplicationFailure.nonRetryable('SONARQUBE_PROJECT_KEY is not set', 'MissingConfigError');
  }
  return {
    mcpGitlabUrl:    process.env.MCP_GITLAB_INTERNAL_URL ?? 'http://mcp-gitlab:3000/mcp',     // NOSONAR
    mcpSonarqubeUrl: process.env.MCP_SONARQUBE_INTERNAL_URL ?? 'http://mcp-sonarqube:3000/mcp', // NOSONAR
    projectKey,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  };
}

function extractFilePath(component: string): string {
  const colonIdx = component.indexOf(':');
  return colonIdx >= 0 ? component.slice(colonIdx + 1) : component;
}

function buildCommitMessage(issues: SonarIssue[], filePath: string): string {
  const keys = issues.map((i) => i.key).join(', ');
  const fileName = filePath.split('/').pop() ?? filePath;
  const raw = `fix(sonar): [${keys}] fix ${issues.length} issue(s) in ${fileName}`;
  return raw.length > 72 ? raw.slice(0, 72) : raw;
}

const FIX_SYSTEM_PROMPT = `You are a code correction agent. Given a TypeScript/JavaScript file and one or more SonarQube issues detected in it, produce a corrected version that resolves all listed issues. Make minimal, targeted changes. Call apply_fix with the complete corrected file content.`;

const APPLY_FIX_TOOL: Anthropic.Tool = {
  name: 'apply_fix',
  description: 'Submit the corrected file content',
  input_schema: {
    type: 'object',
    properties: {
      fixed_content: { type: 'string', description: 'Complete corrected file content' },
    },
    required: ['fixed_content'],
  },
};

function buildIssueList(issues: SonarIssue[]): string {
  return issues.map((i) => {
    const lineRef = i.line === undefined ? '' : ` (line ${i.line})`;
    return `- [${i.key}] ${i.type} / ${i.severity}${lineRef}: ${i.message}`;
  }).join('\n');
}

interface GitLabFileResponse {
  content: string;
}

async function fetchFileContent(
  mcpGitlabUrl: string,
  projectId: number,
  branch: string,
  filePath: string,
  auditCtx?: AuditContext,
): Promise<string> {
  const text = await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_get_file', {
    project_id: String(projectId),
    file_path: filePath,
    ref: branch,
  }, auditCtx);
  const response = JSON.parse(text || '{}') as GitLabFileResponse;
  return response.content ?? '';
}

async function generateFix(
  client: Anthropic,
  model: string,
  filePath: string,
  fileContent: string,
  issues: SonarIssue[],
): Promise<string | null> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: FIX_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [APPLY_FIX_TOOL],
    tool_choice: { type: 'tool', name: 'apply_fix' },
    messages: [
      {
        role: 'user',
        content: `## File: ${filePath}

### Current content
\`\`\`
${fileContent}
\`\`\`

### SonarQube issues to fix
${buildIssueList(issues)}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'apply_fix',
  );
  if (!toolUse) {
    log.warn('Claude did not call apply_fix', { file: filePath });
    return null;
  }

  const input = toolUse.input as { fixed_content: string };
  return typeof input.fixed_content === 'string' ? input.fixed_content : null;
}

async function commitStaticFix(
  mcpGitlabUrl: string,
  projectId: number,
  branch: string,
  filePath: string,
  content: string,
  issues: SonarIssue[],
  auditCtx?: AuditContext,
): Promise<void> {
  await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_commit_files', {
    project_id: String(projectId),
    branch,
    commit_message: buildCommitMessage(issues, filePath),
    actions: [{ action: 'update', file_path: filePath, content }],
  }, auditCtx);
}

export async function runFixStaticAgent(input: FixStaticInput): Promise<FixStaticOutput> {
  const info = activityInfo();
  const auditCtx: AuditContext = {
    workflowId: info.workflowExecution?.workflowId ?? info.activityId,
    activityName: 'runFixStaticAgent',
  };

  log.info('Fix-static agent starting', { mrIid: input.mrIid, branchName: input.branchName });
  const { mcpGitlabUrl, mcpSonarqubeUrl, projectKey, anthropicModel } = fixStaticConfig();

  const allIssues = await fetchSonarIssues(mcpSonarqubeUrl, projectKey, input.branchName, auditCtx);
  const blocking = allIssues.filter((i) => classifyIssue(i) === 'bloquant');

  if (blocking.length === 0) {
    log.info('No blocking SonarQube issues — nothing to fix', { branchName: input.branchName });
    return { fixed: 0, skipped: 0 };
  }

  log.info('Blocking issues found', { count: blocking.length, branchName: input.branchName });

  // Group issues by file path
  const byFile = new Map<string, SonarIssue[]>();
  for (const issue of blocking) {
    const filePath = extractFilePath(issue.component);
    if (!filePath) {
      log.warn('Could not extract file path from component', { component: issue.component });
      continue;
    }
    const group = byFile.get(filePath) ?? [];
    group.push(issue);
    byFile.set(filePath, group);
  }

  const client = createAnthropicClient();
  let fixed = 0;
  let skipped = 0;

  for (const [filePath, issues] of byFile) {
    try {
      const fileContent = await fetchFileContent(mcpGitlabUrl, input.projectId, input.branchName, filePath, auditCtx);

      auditLog({
        timestamp: new Date().toISOString(),
        workflowId: auditCtx.workflowId,
        activityName: auditCtx.activityName,
        agent: WORKER_NAME,
        eventType: 'llm_call',
        tool: 'claude/messages.create',
        inputSummary: summarize(`fix ${filePath}: ${issues.map((i) => i.key).join(', ')}`),
        outputSummary: '',
      });
      const fixedContent = await generateFix(client, anthropicModel, filePath, fileContent, issues);
      auditLog({
        timestamp: new Date().toISOString(),
        workflowId: auditCtx.workflowId,
        activityName: auditCtx.activityName,
        agent: WORKER_NAME,
        eventType: 'llm_call',
        tool: 'claude/messages.create',
        inputSummary: summarize(`fix ${filePath}: ${issues.map((i) => i.key).join(', ')}`),
        outputSummary: fixedContent ? summarize(`fixed ${filePath}`) : 'no fix produced',
      });

      if (!fixedContent) {
        log.warn('No fix produced for file', { file: filePath, issueCount: issues.length });
        skipped++;
        continue;
      }

      await commitStaticFix(mcpGitlabUrl, input.projectId, input.branchName, filePath, fixedContent, issues, auditCtx);
      log.info('Static fix committed', { file: filePath, issueCount: issues.length, mrIid: input.mrIid });
      fixed++;
    } catch (err) {
      log.warn('Failed to fix file — skipping', {
        file: filePath,
        issueCount: issues.length,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  log.info('Fix-static agent done', { fixed, skipped, mrIid: input.mrIid });
  return { fixed, skipped };
}
