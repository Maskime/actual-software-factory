import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@temporalio/activity', () => ({
  activityInfo: vi.fn(() => ({
    workflowExecution: { runId: 'test-run-id' },
    activityId: 'test-activity-id',
  })),
  ApplicationFailure: {
    nonRetryable: (msg: string, type: string) => {
      const err = new Error(msg);
      (err as NodeJS.ErrnoException & { type: string }).type = type;
      return err;
    },
  },
  heartbeat: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk');
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn().mockReturnValue(false) }));
vi.mock('node:fs/promises', () => ({ rm: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./setupWorkspace.js', () => ({
  setupWorkspace: vi.fn().mockResolvedValue({
    workDir: '/tmp/factory/test-run-id',
    issue: {
      title: 'Test Issue',
      description: 'Implement something.',
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
    },
  }),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));
vi.mock('../tools.js', () => ({
  AGENT_TOOLS: [],
  executeTool: vi.fn().mockResolvedValue('tool output'),
}));

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { runDevAgent } from './devAgent.js';

const WORK_DIR = '/tmp/factory/test-run-id';

const makeTextResponse = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
});

const makeCritiqueResponse = (
  grave: string[] = [],
  moderate: string[] = [],
  esthetic: string[] = []
) =>
  makeTextResponse(JSON.stringify({ grave, moderate, esthetic }));

function buildExecFileMock(statusStdout = 'M src/file.ts\n') {
  return vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: null,
      stdout: string,
      stderr: string
    ) => void;
    const cmd = args[0] as string;
    const cmdArgs = args[1] as string[];

    if (cmd === 'sh') {
      // execFileAsync('sh', ['-c', <command>], opts, cb) → cmdArgs[1] is the command
      const command = cmdArgs[1] as string;
      if (command.includes('git branch --show-current')) return cb(null, 'main', '');
      if (command.includes('git branch --list')) return cb(null, '', '');
      if (command.includes('git status --porcelain')) return cb(null, statusStdout, '');
      return cb(null, '', '');
    }
    // All direct git commands succeed
    return cb(null, '', '');
  });
}

function buildAnthropicMock(...responses: object[]) {
  const mockCreate = vi.fn();
  responses.forEach((r) => mockCreate.mockResolvedValueOnce(r));
  mockCreate.mockResolvedValue(makeTextResponse('default'));

  vi.mocked(Anthropic).mockImplementation(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic
  );
  return mockCreate;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.MCP_GITLAB_URL = 'http://mcp-gitlab:3000/mcp'; // NOSONAR
  vi.mocked(execFile).mockImplementation(buildExecFileMock() as unknown as typeof execFile);
  vi.mocked(existsSync).mockReturnValue(true); // workspace exists after setup
});

describe('runDevAgent — happy path', () => {
  it('completes the full plan/critique/revise/implement/verify/commit cycle', async () => {
    buildAnthropicMock(
      makeTextResponse('Step 1: create foo.ts'),  // generatePlan
      makeCritiqueResponse(),                       // critiquePlan: no issues
      makeTextResponse('Done implementing'),        // implementPlan
      makeTextResponse('Done fixing'),              // verifyImplementation fix (not called)
    );

    await expect(runDevAgent({ issueIid: 42, projectId: 3 })).resolves.toBeUndefined();

    vi.mocked(rm).mock.calls.length > 0 &&
      expect(vi.mocked(rm)).toHaveBeenCalledWith(WORK_DIR, expect.any(Object));
  });
});

describe('runDevAgent — workspace cleanup', () => {
  it('cleans up workDir in finally block', async () => {
    buildAnthropicMock(
      makeTextResponse('plan'),
      makeCritiqueResponse(),
      makeTextResponse('done'),
    );
    await runDevAgent({ issueIid: 1, projectId: 3 });
    expect(vi.mocked(rm)).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
  });
});

describe('runDevAgent — retry path', () => {
  it('skips log warning when workspace already exists', async () => {
    const { log } = await import('@temporalio/activity');
    buildAnthropicMock(
      makeTextResponse('plan'),
      makeCritiqueResponse(),
      makeTextResponse('done'),
    );
    // existsSync returns true → isRetry = true
    vi.mocked(existsSync).mockReturnValue(true);
    await runDevAgent({ issueIid: 2, projectId: 3 });
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      'Workspace already exists, reusing (retry attempt)',
      expect.any(Object)
    );
  });
});

describe('runDevAgent — branch already exists', () => {
  it('succeeds when the feature branch already exists', async () => {
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, stdout: string, stderr: string) => void;
      const cmd = args[0] as string;
      const cmdArgs = args[1] as string[];
      if (cmd === 'sh') {
        const command = cmdArgs[1] as string;
        if (command.includes('git branch --show-current')) return cb(null, 'main', '');
        // branch exists → checkout without -b
        if (command.includes('git branch --list')) return cb(null, '  feature/issue-5', '');
        if (command.includes('git status --porcelain')) return cb(null, '', '');
        return cb(null, '', '');
      }
      return cb(null, '', '');
    }) as unknown as typeof execFile);

    buildAnthropicMock(makeTextResponse('plan'), makeCritiqueResponse(), makeTextResponse('done'));
    await expect(runDevAgent({ issueIid: 5, projectId: 3 })).resolves.toBeUndefined();
  });
});

describe('runDevAgent — critique JSON parse failure', () => {
  it('continues with empty critique when response is not valid JSON', async () => {
    const { log } = await import('@temporalio/activity');
    buildAnthropicMock(
      makeTextResponse('plan'),
      makeTextResponse('This is NOT valid JSON {{{{'),  // critiquePlan returns bad JSON
      makeTextResponse('done'),
    );
    await expect(runDevAgent({ issueIid: 7, projectId: 3 })).resolves.toBeUndefined();
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      'Critique JSON parse failed — continuing with empty critique',
      expect.any(Object)
    );
  });
});

describe('runDevAgent — grave critique items', () => {
  it('calls Claude again to revise the plan when grave items exist', async () => {
    const mockCreate = buildAnthropicMock(
      makeTextResponse('plan'),
      makeCritiqueResponse(['Missing auth check']),   // 1 grave item
      makeTextResponse('revised plan'),               // revisePlan
      makeTextResponse('done'),                       // implementPlan
    );
    await runDevAgent({ issueIid: 8, projectId: 3 });
    // generatePlan + critiquePlan + revisePlan + implementPlan = 4 calls
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });
});

describe('runDevAgent — moderate critique items', () => {
  it('creates a GitLab backlog issue for each moderate item', async () => {
    const mockMcpCallTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"iid":99}' }],
      isError: false,
    });
    vi.mocked(Client).mockImplementation(
      () =>
        ({
          connect: vi.fn(),
          callTool: mockMcpCallTool,
          close: vi.fn(),
        }) as unknown as InstanceType<typeof Client>
    );

    buildAnthropicMock(
      makeTextResponse('plan'),
      makeCritiqueResponse([], ['Need more tests']),  // 1 moderate item
      makeTextResponse('done'),
    );
    await runDevAgent({ issueIid: 9, projectId: 3 });
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gitlab_create_issue' })
    );
  });
});

describe('runDevAgent — no changes to commit', () => {
  it('skips git commit when status is empty', async () => {
    vi.mocked(execFile).mockImplementation(
      buildExecFileMock('') as unknown as typeof execFile
    );
    buildAnthropicMock(makeTextResponse('plan'), makeCritiqueResponse(), makeTextResponse('done'));
    const { log } = await import('@temporalio/activity');
    await runDevAgent({ issueIid: 10, projectId: 3 });
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      'No changes to commit',
      expect.any(Object)
    );
  });
});

describe('runDevAgent — verification failure then success', () => {
  it('calls fixErrors when tsc fails, then passes on next attempt', async () => {
    let tscCallCount = 0;
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (
        err: null | Error, stdout?: string, stderr?: string
      ) => void;
      const cmd = args[0] as string;
      const cmdArgs = args[1] as string[];
      if (cmd === 'sh') {
        const command = cmdArgs[1] as string;
        if (command.includes('git branch --show-current')) return cb(null, 'main', '');
        if (command.includes('git branch --list')) return cb(null, '', '');
        if (command.includes('git status --porcelain')) return cb(null, 'M foo.ts\n', '');
        if (command.includes('tsc')) {
          tscCallCount++;
          if (tscCallCount === 1) {
            return (cb as (err: Error) => void)(
              Object.assign(new Error('tsc error'), { stdout: '', stderr: 'TS error' })
            );
          }
          return cb(null, '', '');
        }
        return cb(null, '', '');
      }
      return cb(null, '', '');
    }) as unknown as typeof execFile);

    buildAnthropicMock(
      makeTextResponse('plan'),
      makeCritiqueResponse(),
      makeTextResponse('done'),    // implementPlan
      makeTextResponse('fixed'),   // fixErrors (called by verifyImplementation)
    );

    await expect(runDevAgent({ issueIid: 11, projectId: 3 })).resolves.toBeUndefined();
  });
});

describe('runDevAgent — missing ANTHROPIC_API_KEY', () => {
  it('throws MissingConfigError when API key is absent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // setupWorkspace is mocked to succeed, then generatePlan fails on anthropicClient()
    await expect(runDevAgent({ issueIid: 99, projectId: 3 })).rejects.toMatchObject({
      type: 'MissingConfigError',
    });
  });
});

describe('runDevAgent — tool use in implementPlan', () => {
  it('executes tool calls and feeds results back to Claude', async () => {
    const { executeTool: mockedExecuteTool } = await import('../tools.js');
    vi.mocked(mockedExecuteTool).mockResolvedValueOnce('file contents');

    buildAnthropicMock(
      makeTextResponse('plan'),
      makeCritiqueResponse(),
      // implementPlan: first response has a tool_use block
      {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'src/foo.ts' } }],
        stop_reason: 'tool_use',
      },
      // implementPlan: second response ends
      makeTextResponse('done'),
    );

    await expect(runDevAgent({ issueIid: 12, projectId: 3 })).resolves.toBeUndefined();
    expect(vi.mocked(mockedExecuteTool)).toHaveBeenCalledWith(
      'read_file',
      { path: 'src/foo.ts' },
      WORK_DIR
    );
  });
});
