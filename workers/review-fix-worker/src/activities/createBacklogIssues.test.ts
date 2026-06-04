import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallMcpTool } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
}));

vi.mock('@factory/worker-shared', () => ({
  callMcpTool: mockCallMcpTool,
}));

vi.mock('@temporalio/activity', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createBacklogIssues } from './createBacklogIssues.js';

const INPUT = { projectId: 3, mrIid: 10 };

function mrText(comments: unknown[], webUrl = 'http://gitlab/mr/10'): string {
  return JSON.stringify({ web_url: webUrl, comments });
}

function listIssuesText(issues: { title: string }[]): string {
  return JSON.stringify(issues);
}

function createIssueText(iid = 42): string {
  return JSON.stringify({ iid, web_url: 'http://gitlab/issues/42' });
}

describe('createBacklogIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { created: 0, skipped: 0 } when MR has no comments', async () => {
    mockCallMcpTool.mockResolvedValueOnce(mrText([]));
    expect(await createBacklogIssues(INPUT)).toEqual({ created: 0, skipped: 0 });
    // list_issues must NOT be called when there are no [MODÉRÉ] notes
    expect(mockCallMcpTool).toHaveBeenCalledTimes(1);
  });

  it('returns { created: 0, skipped: 0 } when no comments start with [MODÉRÉ]', async () => {
    mockCallMcpTool.mockResolvedValueOnce(mrText([
      { id: 1, body: '[BLOQUANT] SQL injection', position: { new_path: 'src/db.ts', new_line: 5 } },
      { id: 2, body: '[ESTHÉTIQUE] Rename variable', position: null },
    ]));
    expect(await createBacklogIssues(INPUT)).toEqual({ created: 0, skipped: 0 });
    expect(mockCallMcpTool).toHaveBeenCalledTimes(1);
  });

  it('skips a moderate comment whose backlog issue already exists', async () => {
    const description = 'Missing error handling';
    const existingTitle = '[Backlog] src/api.ts:10 — Missing error handling';
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: `[MODÉRÉ] ${description}`, position: { new_path: 'src/api.ts', new_line: 10 } },
      ]))
      .mockResolvedValueOnce(listIssuesText([{ title: existingTitle }]))
      .mockResolvedValueOnce(listIssuesText([]));  // page 2 → empty → stop

    expect(await createBacklogIssues(INPUT)).toEqual({ created: 0, skipped: 1 });
    const toolNames = mockCallMcpTool.mock.calls.map((c) => c[2]);
    expect(toolNames).not.toContain('gitlab_create_issue');
  });

  it('creates an issue for a moderate comment with no existing backlog issue', async () => {
    const description = 'Missing null check';
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: `[MODÉRÉ] ${description}`, position: { new_path: 'src/foo.ts', new_line: 7 } },
      ]))
      .mockResolvedValueOnce(listIssuesText([]))  // no existing issues
      .mockResolvedValueOnce(createIssueText());

    expect(await createBacklogIssues(INPUT)).toEqual({ created: 1, skipped: 0 });

    const createCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'gitlab_create_issue');
    expect(createCall).toBeDefined();
    const args = createCall![3] as { title: string; description: string; labels: string };
    expect(args.title).toBe('[Backlog] src/foo.ts:7 — Missing null check');
    expect(args.labels).toBe('backlog');
    expect(args.description).toContain('Missing null check');
    expect(args.description).toContain('http://gitlab/mr/10');
    expect(args.description).toContain('src/foo.ts:7');
  });

  it('handles mixed: 1 existing + 1 new → { created: 1, skipped: 1 }', async () => {
    const existingTitle = '[Backlog] src/a.ts:1 — Existing issue';
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[MODÉRÉ] Existing issue', position: { new_path: 'src/a.ts', new_line: 1 } },
        { id: 2, body: '[MODÉRÉ] New issue', position: { new_path: 'src/b.ts', new_line: 2 } },
      ]))
      .mockResolvedValueOnce(listIssuesText([{ title: existingTitle }]))
      .mockResolvedValueOnce(listIssuesText([]))  // page 2 → stop
      .mockResolvedValueOnce(createIssueText());

    expect(await createBacklogIssues(INPUT)).toEqual({ created: 1, skipped: 1 });

    // Call order: gitlab_get_mr → list_issues p1 → list_issues p2 → create_issue
    const toolNames = mockCallMcpTool.mock.calls.map((c) => c[2]);
    expect(toolNames).toEqual([
      'gitlab_get_mr',
      'gitlab_list_issues',
      'gitlab_list_issues',
      'gitlab_create_issue',
    ]);
  });

  it('counts as skipped when gitlab_create_issue throws', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[MODÉRÉ] Some issue', position: { new_path: 'src/x.ts', new_line: 3 } },
      ]))
      .mockResolvedValueOnce(listIssuesText([]))  // page 1 → empty → stop pagination
      .mockRejectedValueOnce(new Error('gitlab_create_issue failed'));

    expect(await createBacklogIssues(INPUT)).toEqual({ created: 0, skipped: 1 });
  });

  it('does not treat summary note as a moderate comment', async () => {
    // The review summary starts with "## Synthese" and contains [MODÉRÉ] in a Markdown table
    const summaryBody = [
      '## Synthese de la revue de code',
      '',
      '| Classification | Nombre |',
      '|---|---|',
      '| [BLOQUANT] | 1 |',
      '| [MODÉRÉ] | 2 |',
      '| [ESTHÉTIQUE] | 0 |',
      '',
      '**Total : 3 commentaire(s)**',
    ].join('\n');
    mockCallMcpTool.mockResolvedValueOnce(mrText([
      { id: 1, body: summaryBody, position: null },
    ]));
    expect(await createBacklogIssues(INPUT)).toEqual({ created: 0, skipped: 0 });
    expect(mockCallMcpTool).toHaveBeenCalledTimes(1);
  });

  it('paginates list_issues until an empty page is returned', async () => {
    const page1Issues = Array.from({ length: 100 }, (_, i) => ({ title: `[Backlog] issue ${i}` }));
    const description = 'New feedback';
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: `[MODÉRÉ] ${description}`, position: { new_path: 'src/z.ts', new_line: 1 } },
      ]))
      .mockResolvedValueOnce(listIssuesText(page1Issues))  // page 1 — 100 issues
      .mockResolvedValueOnce(listIssuesText([]))            // page 2 — empty → stop
      .mockResolvedValueOnce(createIssueText());

    expect(await createBacklogIssues(INPUT)).toEqual({ created: 1, skipped: 0 });

    const listCalls = mockCallMcpTool.mock.calls.filter((c) => c[2] === 'gitlab_list_issues');
    expect(listCalls).toHaveLength(2);
    expect((listCalls[0]![3] as { page: number }).page).toBe(1);
    expect((listCalls[1]![3] as { page: number }).page).toBe(2);
  });
});
