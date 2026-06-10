import { ApplicationFailure, activityInfo, heartbeat, log } from '@temporalio/activity';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auditLog, metricLog, summarize, type AuditContext } from '@factory/worker-shared';
import { setupWorkspace } from './setupWorkspace.js';
import { AGENT_TOOLS, executeTool } from '../tools.js';
import type { DevAgentOutput, IssueContext, WorkspaceContext } from '../types.js';
import { slugify } from '../utils.js';
import {
  DEV_AGENT_PLAN_SYSTEM,
  DEV_AGENT_CRITIQUE_SYSTEM,
  DEV_AGENT_MR_DESC_SYSTEM,
  buildDevAgentImplementSystem,
  buildDevAgentFixErrorsSystem,
  buildDevAgentPlanMessage,
  buildDevAgentCritiqueMessage,
  buildDevAgentReviseMessage,
  buildDevAgentImplementMessage,
  buildDevAgentFixErrorsMessage,
  buildDevAgentMrDescMessage,
} from '../prompts/dev-agent.js';

function execFileAsync(
  file: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        const error = err as Error & { stdout: string; stderr: string };
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      }
    });
  });
}

interface DevAgentInput {
  issueIid: number;
  projectId: number;
}

interface CritiqueResult {
  grave: string[];
  moderate: string[];
  esthetic: string[];
}

const MAX_ITERATIONS = 50;

function devConfig(): { model: string; mcpGitlabUrl: string } {
  return {
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    mcpGitlabUrl: process.env.MCP_GITLAB_URL ?? 'http://mcp-gitlab:3000/mcp', // NOSONAR
  };
}

function anthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw ApplicationFailure.nonRetryable('ANTHROPIC_API_KEY is not set', 'MissingConfigError');
  }
  return new Anthropic({ apiKey });
}

async function execBash(
  command: string,
  cwd: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
      cwd,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 4,
    });
    return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

interface AgentLoopOptions {
  maxTokens?: number;
  heartbeatMeta?: Record<string, unknown>;
}

async function runAgentLoop(
  client: Anthropic,
  model: string,
  system: Anthropic.TextBlockParam[],
  initialMessages: Anthropic.MessageParam[],
  workDir: string,
  maxIter: number,
  options: AgentLoopOptions = {}
): Promise<void> {
  const { maxTokens = 8096, heartbeatMeta = {} } = options;
  const messages = [...initialMessages];
  let iterations = 0;
  while (iterations < maxIter) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: AGENT_TOOLS,
      messages,
    });
    heartbeat({ ...heartbeatMeta, iteration: iterations });
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'end_turn') break;
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (toolUses.length === 0) break;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let result: string;
      try {
        result = await executeTool(tu.name, tu.input as Record<string, unknown>, workDir);
      } catch (err) {
        result = `[tool error] ${err instanceof Error ? err.message : String(err)}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
    }
    messages.push({ role: 'user', content: toolResults });
    iterations++;
  }
  if (iterations >= maxIter) {
    throw ApplicationFailure.nonRetryable(
      `Agent reached max iterations (${maxIter})`,
      'MaxIterationsError'
    );
  }
}

async function generatePlan(issue: IssueContext, workDir: string, auditCtx?: AuditContext): Promise<string> {
  const client = anthropicClient();
  const { model } = devConfig();

  const dirListing = (await execBash('find . -type f -name "*.ts" | head -60', workDir)).stdout;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: DEV_AGENT_PLAN_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildDevAgentPlanMessage(issue.title, issue.description, issue.acceptanceCriteria, dirListing),
      },
    ],
  });

  const plan = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  log.info('Plan generated', { issueTitle: issue.title, planLength: plan.length });
  if (auditCtx) {
    auditLog({
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      activityName: auditCtx.activityName,
      agent: 'agent-worker',
      eventType: 'llm_call',
      tool: 'claude/messages.create',
      inputSummary: summarize(`generatePlan: ${issue.title}`),
      outputSummary: summarize(`plan length: ${plan.length} chars`),
    });
  }
  return plan;
}

async function critiquePlan(issue: IssueContext, plan: string, auditCtx?: AuditContext): Promise<CritiqueResult> {
  const client = anthropicClient();
  const { model } = devConfig();

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: DEV_AGENT_CRITIQUE_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildDevAgentCritiqueMessage(issue.title, issue.acceptanceCriteria, plan),
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    const stripped = raw.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(stripped) as CritiqueResult;
    const result = {
      grave: Array.isArray(parsed.grave) ? parsed.grave : [],
      moderate: Array.isArray(parsed.moderate) ? parsed.moderate : [],
      esthetic: Array.isArray(parsed.esthetic) ? parsed.esthetic : [],
    };
    if (auditCtx) {
      auditLog({
        timestamp: new Date().toISOString(),
        workflowId: auditCtx.workflowId,
        activityName: auditCtx.activityName,
        agent: 'agent-worker',
        eventType: 'llm_call',
        tool: 'claude/messages.create',
        inputSummary: summarize(`critiquePlan: ${issue.title}`),
        outputSummary: summarize(`grave:${result.grave.length} moderate:${result.moderate.length} esthetic:${result.esthetic.length}`),
      });
    }
    return result;
  } catch {
    log.warn('Critique JSON parse failed — continuing with empty critique', { raw });
    return { grave: [], moderate: [], esthetic: [] };
  }
}

async function createBacklogIssue(
  projectId: number,
  mcpGitlabUrl: string,
  title: string,
  description: string,
  auditCtx?: AuditContext,
): Promise<void> {
  const mcpClient = new Client({ name: 'agent-worker', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpGitlabUrl));
  await mcpClient.connect(transport);
  try {
    type ToolContent = { type: string; text?: string };
    type ToolResult = { content: ToolContent[]; isError?: boolean };
    const args = { project_id: String(projectId), title, description, labels: 'backlog' };
    const result = (await mcpClient.callTool({ name: 'gitlab_create_issue', arguments: args })) as ToolResult;
    const resultText = result.content.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) {
      log.warn('Failed to create backlog issue', { title, error: resultText });
    }
    if (auditCtx) {
      auditLog({
        timestamp: new Date().toISOString(),
        workflowId: auditCtx.workflowId,
        activityName: auditCtx.activityName,
        agent: 'agent-worker',
        eventType: 'mcp_call',
        tool: 'gitlab_create_issue',
        inputSummary: summarize(args),
        outputSummary: summarize(resultText),
      });
    }
  } finally {
    await mcpClient.close();
  }
}

async function revisePlan(
  plan: string,
  critique: CritiqueResult,
  issue: IssueContext,
  projectId: number,
  mcpGitlabUrl: string,
  auditCtx?: AuditContext,
): Promise<string> {
  for (const item of critique.moderate) {
    try {
      await createBacklogIssue(
        projectId,
        mcpGitlabUrl,
        `[Backlog] ${issue.title} — ${item.slice(0, 80)}`,
        `Technical debt identified during dev agent plan review.\n\n**Original issue**: ${issue.title}\n\n**Item**: ${item}`,
        auditCtx,
      );
    } catch (err) {
      log.warn('Could not create backlog issue', {
        item,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (critique.grave.length === 0) return plan;

  const client = anthropicClient();
  const { model } = devConfig();

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: buildDevAgentReviseMessage(plan, critique.grave),
      },
    ],
  });

  const revised = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  if (auditCtx) {
    auditLog({
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      activityName: auditCtx.activityName,
      agent: 'agent-worker',
      eventType: 'llm_call',
      tool: 'claude/messages.create',
      inputSummary: summarize(`revisePlan: ${issue.title} — ${critique.grave.length} grave issue(s)`),
      outputSummary: summarize(`revised plan length: ${revised.length} chars`),
    });
  }
  return revised;
}

async function implementPlan(
  revisedPlan: string,
  issue: IssueContext,
  workDir: string
): Promise<void> {
  const client = anthropicClient();
  const { model } = devConfig();

  const systemPrompt: Anthropic.TextBlockParam = {
    type: 'text',
    text: buildDevAgentImplementSystem(workDir),
    cache_control: { type: 'ephemeral' },
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: buildDevAgentImplementMessage(issue.title, issue.acceptanceCriteria, revisedPlan),
    },
  ];

  await runAgentLoop(client, model, [systemPrompt], messages, workDir, MAX_ITERATIONS);
}

async function fixErrors(errors: string, issue: IssueContext, workDir: string): Promise<void> {
  const client = anthropicClient();
  const { model } = devConfig();

  const systemPrompt: Anthropic.TextBlockParam = {
    type: 'text',
    text: buildDevAgentFixErrorsSystem(workDir),
    cache_control: { type: 'ephemeral' },
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: buildDevAgentFixErrorsMessage(issue.title, errors),
    },
  ];

  await runAgentLoop(client, model, [systemPrompt], messages, workDir, 20, {
    maxTokens: 4096,
    heartbeatMeta: { phase: 'fix-errors' },
  });
}

async function verifyImplementation(issue: IssueContext, workDir: string): Promise<void> {
  log.info('Installing dependencies for verification', { workDir });
  const installResult = await execBash('npm ci', workDir);
  if (!installResult.ok) {
    log.warn('npm ci had errors', { stderr: installResult.stderr });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const tscResult = await execBash('npx tsc --noEmit', workDir);
    const lintResult = await execBash('npm run lint --if-present', workDir);

    if (tscResult.ok && lintResult.ok) {
      log.info('Verification passed', { attempt });
      return;
    }

    const errors = [
      tscResult.ok ? '' : `tsc errors:\n${tscResult.stderr || tscResult.stdout}`,
      lintResult.ok ? '' : `lint errors:\n${lintResult.stderr || lintResult.stdout}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    log.warn('Verification failed, asking Claude to fix', { attempt, errors: errors.slice(0, 500) });
    await fixErrors(errors, issue, workDir);
  }

  throw ApplicationFailure.nonRetryable(
    'Verification failed after 3 fix attempts',
    'VerificationError'
  );
}

async function commitAndPush(
  workDir: string,
  issueIid: number,
  issueTitle: string,
  branchName: string
): Promise<boolean> {
  await execFileAsync('git', ['config', '--local', 'user.email', 'agent@software-factory'], {
    cwd: workDir,
  });
  await execFileAsync('git', ['config', '--local', 'user.name', 'Software Factory Agent'], {
    cwd: workDir,
  });
  await execFileAsync('git', ['add', '-A'], { cwd: workDir });

  const statusResult = await execBash('git status --porcelain', workDir);
  if (!statusResult.stdout.trim()) {
    log.info('No changes to commit', { issueIid });
    return false;
  }

  await execFileAsync(
    'git',
    ['commit', '-m', `feat: implement ${issueTitle} (#${issueIid})`],
    { cwd: workDir }
  );
  await execFileAsync('git', ['push', 'origin', branchName], { cwd: workDir });
  log.info('Code committed and pushed', { issueIid, branch: branchName });
  return true;
}

async function generateMrDescription(
  issue: IssueContext,
  revisedPlan: string,
  issueIid: number
): Promise<string> {
  const client = anthropicClient();
  const { model } = devConfig();

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: DEV_AGENT_MR_DESC_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildDevAgentMrDescMessage(issueIid, issue.title, issue.acceptanceCriteria, revisedPlan),
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

async function createMergeRequest(
  projectId: number,
  issueIid: number,
  issueTitle: string,
  branchName: string,
  description: string,
  mcpGitlabUrl: string,
  auditCtx?: AuditContext,
): Promise<{ iid: number; web_url: string }> {
  const mcpClient = new Client({ name: 'agent-worker', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpGitlabUrl));
  await mcpClient.connect(transport);
  try {
    type ToolContent = { type: string; text?: string };
    type ToolResult = { content: ToolContent[]; isError?: boolean };
    const args = {
      project_id: String(projectId),
      source_branch: branchName,
      target_branch: 'main',
      title: issueTitle,
      description,
    };
    const result = (await mcpClient.callTool({ name: 'gitlab_create_mr', arguments: args })) as ToolResult;
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) {
      throw ApplicationFailure.nonRetryable(`MR creation failed: ${text}`, 'MrCreationError');
    }
    const data = JSON.parse(text) as { iid: number; web_url: string };
    log.info('MR created', { issueIid, mrIid: data.iid, url: data.web_url });
    if (auditCtx) {
      auditLog({
        timestamp: new Date().toISOString(),
        workflowId: auditCtx.workflowId,
        activityName: auditCtx.activityName,
        agent: 'agent-worker',
        eventType: 'mcp_call',
        tool: 'gitlab_create_mr',
        inputSummary: summarize({ ...args, description: '…' }),
        outputSummary: summarize(`mrIid:${data.iid} url:${data.web_url}`),
      });
    }
    return data;
  } finally {
    await mcpClient.close();
  }
}

export async function runDevAgent(input: DevAgentInput): Promise<DevAgentOutput> {
  const info = activityInfo();
  const workflowRunId = info.workflowExecution?.runId ?? info.activityId;
  const auditCtx: AuditContext = {
    workflowId: info.workflowExecution?.workflowId ?? info.activityId,
    activityName: 'runDevAgent',
  };
  const workDir = `/tmp/factory/${workflowRunId}`;
  const startTime = Date.now();
  let devSucceeded = false;

  log.info('Dev agent starting', { issueIid: input.issueIid, workDir });

  let ctx: WorkspaceContext | undefined;

  try {
    const isRetry = existsSync(workDir);
    if (isRetry) {
      log.info('Workspace already exists, reusing (retry attempt)', { workDir });
    }
    ctx = await setupWorkspace({ ...input, workflowRunId });

    const slug = slugify(ctx.issue.title) || String(input.issueIid);
    const branchName = `feature/${input.issueIid}-${slug}`;
    const currentBranch = (await execBash('git branch --show-current', workDir)).stdout.trim();
    if (currentBranch !== branchName) {
      const branchExists =
        (await execBash(`git branch --list ${branchName}`, workDir)).stdout.trim().length > 0;
      if (branchExists) {
        await execFileAsync('git', ['checkout', branchName], { cwd: workDir });
      } else {
        await execFileAsync('git', ['checkout', '-b', branchName], { cwd: workDir });
      }
    }

    const { mcpGitlabUrl } = devConfig();

    log.info('Generating implementation plan', { issueIid: input.issueIid });
    const plan = await generatePlan(ctx.issue, workDir, auditCtx);

    log.info('Critiquing plan', { issueIid: input.issueIid });
    const critique = await critiquePlan(ctx.issue, plan, auditCtx);
    log.info('Critique complete', {
      grave: critique.grave.length,
      moderate: critique.moderate.length,
      esthetic: critique.esthetic.length,
    });

    log.info('Revising plan', { issueIid: input.issueIid });
    const revisedPlan = await revisePlan(plan, critique, ctx.issue, input.projectId, mcpGitlabUrl, auditCtx);

    log.info('Implementing plan', { issueIid: input.issueIid });
    await implementPlan(revisedPlan, ctx.issue, workDir);

    log.info('Verifying implementation', { issueIid: input.issueIid });
    await verifyImplementation(ctx.issue, workDir);

    log.info('Committing and pushing', { issueIid: input.issueIid });
    const pushed = await commitAndPush(workDir, input.issueIid, ctx.issue.title, branchName);

    if (!pushed) {
      throw ApplicationFailure.nonRetryable(
        'No changes to commit after implementation',
        'EmptyImplementationError'
      );
    }

    log.info('Generating MR description', { issueIid: input.issueIid });
    const mrDescription = await generateMrDescription(ctx.issue, revisedPlan, input.issueIid);

    log.info('Creating Merge Request', { issueIid: input.issueIid });
    const mrData = await createMergeRequest(
      input.projectId,
      input.issueIid,
      ctx.issue.title,
      branchName,
      mrDescription,
      mcpGitlabUrl,
      auditCtx,
    );

    log.info('Dev agent completed successfully', { issueIid: input.issueIid });
    devSucceeded = true;
    return { mrIid: mrData.iid, branchName, projectId: input.projectId };
  } finally {
    metricLog({
      type: 'metric',
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      stage: 'dev',
      status: devSucceeded ? 'success' : 'failure',
      durationMs: Date.now() - startTime,
    });
    if (ctx && existsSync(workDir)) {
      try {
        await rm(workDir, { recursive: true, force: true });
        log.info('Workspace cleaned up', { workDir });
      } catch (err) {
        log.warn('Failed to clean up workspace', {
          workDir,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
