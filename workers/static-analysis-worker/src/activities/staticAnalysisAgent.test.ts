import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCallMcpTool } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
}));

vi.mock('@factory/worker-shared', () => ({
  callMcpTool: mockCallMcpTool,
  auditLog: vi.fn(),
  metricLog: vi.fn(),
  summarize: vi.fn((v: unknown) => String(v)),
}));

vi.mock('@temporalio/activity', () => ({
  ApplicationFailure: {
    nonRetryable: vi.fn().mockImplementation((msg: string, type: string) => {
      const err = new Error(msg) as Error & { type: string };
      err.type = type;
      return err;
    }),
  },
  log: { info: vi.fn(), warn: vi.fn() },
  activityInfo: vi.fn(() => ({
    workflowExecution: { workflowId: 'test-workflow-id', runId: 'test-run-id' },
    activityId: 'test-activity-id',
    activityType: { name: 'runStaticAnalysisAgent' },
  })),
}));

import {
  classifyIssue,
  runStaticAnalysisAgent,
  createBacklogIssues,
  type SonarIssue,
  type StaticAnalysisInput,
} from './staticAnalysisAgent.js';

const BASE_INPUT: StaticAnalysisInput = {
  issueIid:   1,
  projectId:  3,
  mrIid:      10,
  branchName: 'feature/1-add-feature',
};

function makeIssuesResponse(issues: SonarIssue[]): string {
  return JSON.stringify({ issues });
}

function makeHotspotsResponse(hotspots: Array<{
  key: string; component: string; message: string;
  vulnerabilityProbability?: string; line?: number;
}>): string {
  return JSON.stringify({ hotspots });
}

function emptyHotspots(): string {
  return JSON.stringify({ hotspots: [] });
}

describe('classifyIssue', () => {
  it('classifies BUG as bloquant', () => {
    const issue: SonarIssue = { key: 'k1', type: 'BUG', severity: 'MAJOR', message: 'bug', component: 'foo.ts' };
    expect(classifyIssue(issue)).toBe('bloquant');
  });

  it('classifies VULNERABILITY as bloquant', () => {
    const issue: SonarIssue = { key: 'k2', type: 'VULNERABILITY', severity: 'CRITICAL', message: 'vuln', component: 'foo.ts' };
    expect(classifyIssue(issue)).toBe('bloquant');
  });

  it('classifies SECURITY_HOTSPOT HIGH as bloquant', () => {
    const issue: SonarIssue = { key: 'k3', type: 'SECURITY_HOTSPOT', severity: 'MAJOR', message: 'hot', component: 'foo.ts', vulnerabilityProbability: 'HIGH' };
    expect(classifyIssue(issue)).toBe('bloquant');
  });

  it('classifies SECURITY_HOTSPOT MEDIUM as modéré', () => {
    const issue: SonarIssue = { key: 'k4', type: 'SECURITY_HOTSPOT', severity: 'MAJOR', message: 'hot', component: 'foo.ts', vulnerabilityProbability: 'MEDIUM' };
    expect(classifyIssue(issue)).toBe('modéré');
  });

  it('classifies SECURITY_HOTSPOT LOW as modéré', () => {
    const issue: SonarIssue = { key: 'k5', type: 'SECURITY_HOTSPOT', severity: 'MINOR', message: 'hot', component: 'foo.ts', vulnerabilityProbability: 'LOW' };
    expect(classifyIssue(issue)).toBe('modéré');
  });

  it('classifies CODE_SMELL as modéré', () => {
    const issue: SonarIssue = { key: 'k6', type: 'CODE_SMELL', severity: 'INFO', message: 'smell', component: 'foo.ts' };
    expect(classifyIssue(issue)).toBe('modéré');
  });
});

describe('runStaticAnalysisAgent', () => {
  beforeEach(() => {
    process.env.SONARQUBE_PROJECT_KEY = 'test-project-key';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SONARQUBE_PROJECT_KEY;
  });

  it('returns hasBlockingIssues: false when no issues found', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([]))
      .mockResolvedValueOnce(makeHotspotsResponse([]));

    const result = await runStaticAnalysisAgent(BASE_INPUT);

    expect(result.hasBlockingIssues).toBe(false);
    expect(result.bloquant).toHaveLength(0);
    expect(result.modéré).toHaveLength(0);
  });

  it('returns hasBlockingIssues: true when BUG is present', async () => {
    const bugIssue: SonarIssue = { key: 'bug1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'src/foo.ts', line: 42 };
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([bugIssue]))
      .mockResolvedValueOnce(emptyHotspots());

    const result = await runStaticAnalysisAgent(BASE_INPUT);

    expect(result.hasBlockingIssues).toBe(true);
    expect(result.bloquant).toHaveLength(1);
    expect(result.bloquant[0].key).toBe('bug1');
    expect(result.modéré).toHaveLength(0);
  });

  it('separates bloquant and modéré correctly', async () => {
    const bugIssue: SonarIssue    = { key: 'b1', type: 'BUG',        severity: 'MAJOR', message: 'bug',   component: 'a.ts' };
    const smellIssue: SonarIssue  = { key: 's1', type: 'CODE_SMELL', severity: 'INFO',  message: 'smell', component: 'b.ts' };
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([bugIssue, smellIssue]))
      .mockResolvedValueOnce(emptyHotspots())
      .mockResolvedValueOnce(JSON.stringify([]))           // gitlab_list_issues → empty backlog
      .mockResolvedValueOnce(JSON.stringify({ iid: 1 })); // gitlab_create_issue

    const result = await runStaticAnalysisAgent(BASE_INPUT);

    expect(result.bloquant).toHaveLength(1);
    expect(result.modéré).toHaveLength(1);
    expect(result.bloquant[0].key).toBe('b1');
    expect(result.modéré[0].key).toBe('s1');
  });

  it('classifies HIGH hotspot from hotspot endpoint as bloquant', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([]))
      .mockResolvedValueOnce(makeHotspotsResponse([{
        key: 'h1', component: 'src/auth.ts', message: 'hardcoded secret',
        vulnerabilityProbability: 'HIGH', line: 10,
      }]));

    const result = await runStaticAnalysisAgent(BASE_INPUT);

    expect(result.hasBlockingIssues).toBe(true);
    expect(result.bloquant[0].type).toBe('SECURITY_HOTSPOT');
    expect(result.bloquant[0].vulnerabilityProbability).toBe('HIGH');
  });

  it('throws nonRetryable when SONARQUBE_PROJECT_KEY is not set', async () => {
    delete process.env.SONARQUBE_PROJECT_KEY;

    await expect(runStaticAnalysisAgent(BASE_INPUT)).rejects.toMatchObject({
      message: 'SONARQUBE_PROJECT_KEY is not set',
    });
  });

  it('passes branchName and projectKey to MCP calls', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([]))
      .mockResolvedValueOnce(emptyHotspots());

    await runStaticAnalysisAgent(BASE_INPUT);

    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'static-analysis-worker',
      expect.any(String),
      'search_sonar_issues_in_projects',
      { projectKey: 'test-project-key', branch: BASE_INPUT.branchName },
      expect.objectContaining({ workflowId: expect.any(String) }),
    );
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'static-analysis-worker',
      expect.any(String),
      'search_security_hotspots',
      { projectKey: 'test-project-key', branch: BASE_INPUT.branchName },
      expect.objectContaining({ workflowId: expect.any(String) }),
    );
  });

  it('returns empty results gracefully when MCP returns unparseable response', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce('{}');

    const result = await runStaticAnalysisAgent(BASE_INPUT);

    expect(result.hasBlockingIssues).toBe(false);
    expect(result.bloquant).toHaveLength(0);
  });

  it('calls createBacklogIssues with modéré issues and correct projectId', async () => {
    const smellIssue: SonarIssue = { key: 's1', type: 'CODE_SMELL', severity: 'INFO', message: 'smell', component: 'proj:src/foo.ts' };
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([smellIssue]))
      .mockResolvedValueOnce(emptyHotspots())
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce(JSON.stringify({ iid: 42 }));

    await runStaticAnalysisAgent(BASE_INPUT);

    const createCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'gitlab_create_issue');
    expect(createCall).toBeDefined();
    expect(createCall![3]).toMatchObject({ project_id: String(BASE_INPUT.projectId), labels: 'backlog' });
  });
});

describe('createBacklogIssues', () => {
  const GITLAB_URL = 'http://mcp-gitlab:3000/mcp';
  const PROJECT_ID = 3;

  beforeEach(() => vi.clearAllMocks());

  const smell = (key: string, component: string): SonarIssue => ({
    key, type: 'CODE_SMELL', severity: 'INFO', message: 'a smell', component,
  });

  it('creates an issue when backlog is empty', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce(JSON.stringify({ iid: 1 }));

    const result = await createBacklogIssues(GITLAB_URL, PROJECT_ID, [smell('k1', 'proj:src/foo.ts')]);

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'static-analysis-worker', GITLAB_URL, 'gitlab_create_issue',
      expect.objectContaining({ project_id: '3', labels: 'backlog' }),
      undefined,
    );
  });

  it('skips if title already exists in backlog', async () => {
    const issue = smell('k1', 'proj:src/foo.ts');
    const existingTitle = '[SonarQube] CODE_SMELL — src/foo.ts';
    mockCallMcpTool.mockResolvedValueOnce(JSON.stringify([{ title: existingTitle }]));

    const result = await createBacklogIssues(GITLAB_URL, PROJECT_ID, [issue]);

    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(mockCallMcpTool).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'gitlab_create_issue', expect.anything(), expect.anything(),
    );
  });

  it('creates multiple issues when backlog is empty', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce(JSON.stringify({ iid: 1 }))
      .mockResolvedValueOnce(JSON.stringify({ iid: 2 }));

    const result = await createBacklogIssues(GITLAB_URL, PROJECT_ID, [
      smell('k1', 'proj:src/a.ts'),
      smell('k2', 'proj:src/b.ts'),
    ]);

    expect(result).toEqual({ created: 2, skipped: 0 });
  });

  it('continues and counts as skipped when individual create fails', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockRejectedValueOnce(new Error('gitlab error'));

    const result = await createBacklogIssues(GITLAB_URL, PROJECT_ID, [smell('k1', 'proj:src/foo.ts')]);

    expect(result).toEqual({ created: 0, skipped: 1 });
  });

  it('returns early with no MCP calls when issues list is empty', async () => {
    const result = await createBacklogIssues(GITLAB_URL, PROJECT_ID, []);

    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  it('calls gitlab_list_issues with labels=backlog and state=opened', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce(JSON.stringify({ iid: 1 }));

    await createBacklogIssues(GITLAB_URL, PROJECT_ID, [smell('k1', 'proj:src/foo.ts')]);

    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'static-analysis-worker', GITLAB_URL, 'gitlab_list_issues',
      { project_id: '3', labels: 'backlog', state: 'opened' },
      undefined,
    );
  });

  it('uses rule field in title when available', async () => {
    const issueWithRule: SonarIssue = {
      key: 'k1', type: 'CODE_SMELL', severity: 'INFO', message: 'unused var',
      component: 'proj:src/foo.ts', rule: 'typescript:S1481',
    };
    mockCallMcpTool
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce(JSON.stringify({ iid: 1 }));

    await createBacklogIssues(GITLAB_URL, PROJECT_ID, [issueWithRule]);

    const createCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'gitlab_create_issue');
    expect(createCall![3].title).toBe('[SonarQube] typescript:S1481 — src/foo.ts');
  });

  it('proceeds without dedup when list_issues fails', async () => {
    mockCallMcpTool
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(JSON.stringify({ iid: 1 }));

    const result = await createBacklogIssues(GITLAB_URL, PROJECT_ID, [smell('k1', 'proj:src/foo.ts')]);

    expect(result).toEqual({ created: 1, skipped: 0 });
  });
});
