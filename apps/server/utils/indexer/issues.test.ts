import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock the DB layer ---
const mockQuery = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('../db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withClient: (fn: (c: { query: typeof mockClientQuery }) => unknown) =>
    fn({ query: mockClientQuery }),
}))

// --- Mock the embedding layer ---
const mockEmbedText = vi.fn()
vi.mock('../embedding', () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
  chunkText: vi.fn(),
}))

// --- Mock the MCP client ---
const mockCallTool = vi.fn()
const mockClose = vi.fn()
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: mockCallTool,
    close: mockClose,
  })),
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}))

// --- Mock the logger ---
const { mockLoggerInfo } = vi.hoisted(() => ({ mockLoggerInfo: vi.fn() }))
vi.mock('consola', () => ({
  createConsola: () => ({
    withTag: () => ({ info: mockLoggerInfo, error: vi.fn(), warn: vi.fn() }),
  }),
}))

import { indexProjectIssues, buildIssueChunk, issueSourcePath } from './issues'

interface MockIssue {
  iid: number
  title: string
  description: string | null
  labels: string[]
  state: 'opened' | 'closed'
}

function toolText(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }
}

/** Configure mockCallTool to serve gitlab_list_issues with one page of results. */
function setupGitlab(issues: MockIssue[]) {
  mockCallTool.mockImplementation(
    ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      if (name === 'gitlab_list_issues') {
        const page = (args.page as number) ?? 1
        return Promise.resolve(toolText(page === 1 ? issues : []))
      }
      return Promise.resolve(toolText(null))
    }
  )
}

// --- Unit tests for pure helpers ---

describe('issueSourcePath', () => {
  it('formats as #iid title', () => {
    expect(issueSourcePath(42, 'Fix the bug')).toBe('#42 Fix the bug')
  })
})

describe('buildIssueChunk', () => {
  it('includes title, labels and description', () => {
    const chunk = buildIssueChunk({
      iid: 1,
      title: 'My issue',
      description: 'Some details',
      labels: ['bug', 'high'],
    })
    expect(chunk).toContain('#1 My issue')
    expect(chunk).toContain('Labels: bug, high')
    expect(chunk).toContain('Some details')
  })

  it('omits Labels line when labels array is empty', () => {
    const chunk = buildIssueChunk({ iid: 2, title: 'No labels', description: 'desc', labels: [] })
    expect(chunk).not.toContain('Labels:')
    expect(chunk).toContain('#2 No labels')
  })

  it('truncates to MAX_CHUNK_CHARS for a very long description', () => {
    const longDesc = 'x'.repeat(2000)
    const chunk = buildIssueChunk({ iid: 3, title: 'Long', description: longDesc, labels: [] })
    expect(chunk.length).toBeLessThanOrEqual(1600)
  })
})

// --- Integration tests for indexProjectIssues ---

describe('indexProjectIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    mockEmbedText.mockImplementation((chunks: string[]) =>
      Promise.resolve(chunks.map(() => Array.from({ length: 1024 }, () => 0.1)))
    )
  })

  it('indexes all open issues and inserts one chunk per issue', async () => {
    setupGitlab([
      { iid: 1, title: 'Issue A', description: 'desc A', labels: ['bug'], state: 'opened' },
      { iid: 2, title: 'Issue B', description: 'desc B', labels: [], state: 'opened' },
    ])

    const result = await indexProjectIssues({ projectId: 3 })

    expect(result.issuesIndexed).toBe(2)
    expect(result.chunksUpserted).toBe(2)

    const insertCalls = mockClientQuery.mock.calls.filter(c => String(c[0]).startsWith('INSERT'))
    expect(insertCalls).toHaveLength(2)
    const insertedPaths = insertCalls.map(c => c[1][2])
    expect(insertedPaths).toEqual(['#1 Issue A', '#2 Issue B'])
  })

  it('skips an unchanged issue (same hash): no embedText, no db write', async () => {
    const issue = { iid: 1, title: 'Stable', description: 'content', labels: [], state: 'opened' as const }
    setupGitlab([issue])

    const { buildIssueChunk: bic, issueSourcePath: isp } = await import('./issues')
    const { hashContent } = await import('./shared')

    const sameHash = hashContent(bic(issue))
    const sourcePath = isp(issue.iid, issue.title)

    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT') && (params as unknown[])[2] === sourcePath) {
        return Promise.resolve({ rows: [{ content_hash: sameHash }], rowCount: 1 })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    const result = await indexProjectIssues({ projectId: 3 })

    expect(result.issuesSkipped).toBe(1)
    expect(result.issuesIndexed).toBe(0)
    expect(mockEmbedText).not.toHaveBeenCalled()
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('re-indexes a modified issue: DELETE before INSERT', async () => {
    setupGitlab([
      { iid: 1, title: 'Changed', description: 'new content', labels: [], state: 'opened' },
    ])
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ content_hash: 'stale' }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await indexProjectIssues({ projectId: 3 })

    const ops = mockClientQuery.mock.calls.map(c => String(c[0]).split(' ')[0])
    expect(ops[0]).toBe('DELETE')
    expect(ops[1]).toBe('INSERT')
  })

  it('deletes orphans scoped to source_type=issue after indexing', async () => {
    setupGitlab([
      { iid: 1, title: 'Open', description: 'desc', labels: [], state: 'opened' },
    ])

    await indexProjectIssues({ projectId: 3 })

    const orphanCall = mockQuery.mock.calls.find(c => String(c[0]).startsWith('DELETE'))
    expect(orphanCall).toBeDefined()
    expect(String(orphanCall![0])).toContain('project_id = $1')
    expect(String(orphanCall![0])).toContain('source_type = $2')
    expect(String(orphanCall![0])).toContain('<> ALL($3::text[])')
    expect(orphanCall![1]).toEqual([3, 'issue', ['#1 Open']])
  })

  it('logs progress as (i/total)', async () => {
    setupGitlab([
      { iid: 1, title: 'A', description: null, labels: [], state: 'opened' },
      { iid: 2, title: 'B', description: null, labels: [], state: 'opened' },
    ])

    await indexProjectIssues({ projectId: 3 })

    const logged = mockLoggerInfo.mock.calls.flat().join('\n')
    expect(logged).toContain('(1/2)')
    expect(logged).toContain('(2/2)')
  })
})
