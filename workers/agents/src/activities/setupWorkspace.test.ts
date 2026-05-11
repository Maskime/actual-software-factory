import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { setupWorkspace } from './setupWorkspace.js';

const ISSUE_DESCRIPTION = `Détails de l'issue.

## Critères d'acceptation
- [ ] Premier critère
- [x] Deuxième critère
- [ ] Troisième critère

## Notes
Rien de spécial.`;

function makeMcpClient(overrides?: Partial<{ callTool: ReturnType<typeof vi.fn> }>) {
  const callTool =
    overrides?.callTool ??
    vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ title: 'Test issue', description: ISSUE_DESCRIPTION }),
        },
      ],
      isError: false,
    });
  return { connect: vi.fn(), callTool, close: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();

  process.env.GITLAB_API_TOKEN = 'test-token';
  process.env.GITLAB_API_INTERNAL_URL = 'http://gitlab/api/v4';
  process.env.MCP_GITLAB_INTERNAL_URL = 'http://mcp-gitlab:3000/mcp';

  // Default execFile: success
  vi.mocked(execFile).mockImplementation(
    ((_cmd: string, _args: string[], cb: (err: null, out: string, err2: string) => void) => {
      cb(null, '', '');
    }) as unknown as typeof execFile
  );

  // Default MCP client
  vi.mocked(Client).mockImplementation(() => makeMcpClient() as unknown as InstanceType<typeof Client>);

  // Default fetch: project endpoint
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ http_url_to_repo: 'http://gitlab/root/project.git' }),
  } as Response);
});

describe('setupWorkspace', () => {
  it('returns WorkspaceContext on happy path', async () => {
    const result = await setupWorkspace({
      projectId: 3,
      issueIid: 42,
      workflowRunId: 'run-abc',
    });

    expect(result.workDir).toBe('/tmp/factory/run-abc');
    expect(result.issue.title).toBe('Test issue');
    expect(result.issue.description).toBe(ISSUE_DESCRIPTION);
    expect(result.issue.acceptanceCriteria).toEqual([
      'Premier critère',
      'Deuxième critère',
      'Troisième critère',
    ]);
  });

  it('embeds credentials in the git clone URL', async () => {
    await setupWorkspace({ projectId: 3, issueIid: 1, workflowRunId: 'run-1' });

    const cloneArgs = (vi.mocked(execFile).mock.calls[0] as unknown as [string, string[]])[1];
    expect(cloneArgs[0]).toBe('clone');
    expect(cloneArgs[1]).toBe('--depth=1');
    expect(cloneArgs[2]).toContain('oauth2:test-token@');
    expect(cloneArgs[3]).toBe('/tmp/factory/run-1');
  });

  it('throws non-retryable when GITLAB_API_TOKEN is missing', async () => {
    delete process.env.GITLAB_API_TOKEN;
    await expect(
      setupWorkspace({ projectId: 3, issueIid: 1, workflowRunId: 'run-x' })
    ).rejects.toMatchObject({ type: 'MissingConfigError' });
  });

  it('throws non-retryable on GitLab 404 for project', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(
      setupWorkspace({ projectId: 999, issueIid: 1, workflowRunId: 'run-x' })
    ).rejects.toMatchObject({ type: 'GitLabClientError' });
  });

  it('throws retryable error on GitLab 500 for project', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(
      setupWorkspace({ projectId: 3, issueIid: 1, workflowRunId: 'run-x' })
    ).rejects.toThrow('GitLab API server error 500');
  });

  it('throws non-retryable when MCP returns an error', async () => {
    vi.mocked(Client).mockImplementation(
      () =>
        makeMcpClient({
          callTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Issue not found' }],
            isError: true,
          }),
        }) as unknown as InstanceType<typeof Client>
    );

    await expect(
      setupWorkspace({ projectId: 3, issueIid: 99, workflowRunId: 'run-x' })
    ).rejects.toMatchObject({ type: 'McpGitLabError' });
  });

  it('returns empty acceptanceCriteria when section is absent', async () => {
    vi.mocked(Client).mockImplementation(
      () =>
        makeMcpClient({
          callTool: vi.fn().mockResolvedValue({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ title: 'No AC', description: 'Just some text.' }),
              },
            ],
            isError: false,
          }),
        }) as unknown as InstanceType<typeof Client>
    );

    const result = await setupWorkspace({ projectId: 3, issueIid: 1, workflowRunId: 'run-ac' });
    expect(result.issue.acceptanceCriteria).toEqual([]);
  });
});
