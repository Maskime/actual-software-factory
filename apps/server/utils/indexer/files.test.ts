import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock the DB layer (cf. M4: mock ../db, not pg directly) ---
const mockQuery = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('../db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withClient: (fn: (c: { query: typeof mockClientQuery }) => unknown) =>
    fn({ query: mockClientQuery }),
}))

// --- Mock the embedding layer ---
const mockEmbedText = vi.fn()
const mockChunkText = vi.fn()
vi.mock('../embedding', () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
  chunkText: (...args: unknown[]) => mockChunkText(...args),
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

// --- Mock the logger (vi.hoisted: mock factory runs before const init otherwise) ---
const { mockLoggerInfo } = vi.hoisted(() => ({ mockLoggerInfo: vi.fn() }))
vi.mock('consola', () => ({
  createConsola: () => ({
    withTag: () => ({ info: mockLoggerInfo, error: vi.fn(), warn: vi.fn() }),
  }),
}))

import { indexRepositoryFiles, isIndexable, isExcludedDir } from './files'

function toolText(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }
}

/** Configure the MCP callTool mock with a flat tree and file contents. */
function setupGitlab(opts: {
  tree?: Record<string, Array<{ type: 'blob' | 'tree'; path: string }>>
  files?: Record<string, string>
  defaultBranch?: string
}) {
  const tree = opts.tree ?? {}
  const files = opts.files ?? {}
  mockCallTool.mockImplementation(({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
    if (name === 'gitlab_get_project') {
      return Promise.resolve(toolText({ default_branch: opts.defaultBranch ?? 'main' }))
    }
    if (name === 'gitlab_get_repository_tree') {
      const path = (args.path as string | undefined) ?? '__root__'
      const entries = (tree[path] ?? []).map((e, i) => ({
        id: `id${i}`,
        name: e.path.split('/').pop(),
        type: e.type,
        path: e.path,
        mode: e.type === 'tree' ? '040000' : '100644',
      }))
      return Promise.resolve(toolText(entries))
    }
    if (name === 'gitlab_get_file') {
      return Promise.resolve(toolText({
        file_name: (args.file_path as string).split('/').pop(),
        file_path: args.file_path,
        size: 1,
        content: files[args.file_path as string] ?? '',
        ref: args.ref,
      }))
    }
    return Promise.resolve(toolText(null))
  })
}

describe('isIndexable / isExcludedDir', () => {
  it('accepts .ts/.vue/.md/.json', () => {
    expect(isIndexable('src/a.ts')).toBe(true)
    expect(isIndexable('app/B.vue')).toBe(true)
    expect(isIndexable('README.md')).toBe(true)
    expect(isIndexable('pkg.json')).toBe(true)
  })

  it('rejects other extensions', () => {
    expect(isIndexable('logo.png')).toBe(false)
    expect(isIndexable('script.js')).toBe(false)
  })

  it('rejects files under node_modules/, dist/, .nuxt/', () => {
    expect(isIndexable('node_modules/foo/index.ts')).toBe(false)
    expect(isIndexable('dist/bundle.js')).toBe(false)
    expect(isIndexable('app/.nuxt/types.ts')).toBe(false)
    expect(isExcludedDir('node_modules')).toBe(true)
    expect(isExcludedDir('src')).toBe(false)
  })
})

describe('indexRepositoryFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // default: no existing rows, no orphans
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    mockChunkText.mockImplementation((text: string) => [text])
    mockEmbedText.mockImplementation((chunks: string[]) =>
      Promise.resolve(chunks.map(() => Array.from({ length: 1024 }, () => 0.1)))
    )
  })

  it('indexes only relevant files and prunes excluded directories', async () => {
    setupGitlab({
      tree: {
        __root__: [
          { type: 'blob', path: 'a.ts' },
          { type: 'blob', path: 'logo.png' },
          { type: 'tree', path: 'src' },
          { type: 'tree', path: 'node_modules' },
        ],
        src: [{ type: 'blob', path: 'src/b.vue' }],
      },
      files: { 'a.ts': 'content a', 'src/b.vue': 'content b' },
    })

    const result = await indexRepositoryFiles({ projectId: 3 })

    expect(result.filesIndexed).toBe(2)
    // node_modules directory must never be walked
    const treeCalls = mockCallTool.mock.calls.filter(c => c[0].name === 'gitlab_get_repository_tree')
    expect(treeCalls.some(c => c[0].arguments.path === 'node_modules')).toBe(false)

    // verify the inserted source_paths
    const insertCalls = mockClientQuery.mock.calls.filter(c => String(c[0]).startsWith('INSERT'))
    const insertedPaths = insertCalls.map(c => c[1][2])
    expect(insertedPaths).toEqual(['a.ts', 'src/b.vue'])
  })

  it('re-indexes a modified file: DELETE before INSERT', async () => {
    setupGitlab({
      tree: { __root__: [{ type: 'blob', path: 'a.ts' }] },
      files: { 'a.ts': 'new content' },
    })
    // existing row with a different hash → must re-index
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ content_hash: 'stale' }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await indexRepositoryFiles({ projectId: 3 })

    const ops = mockClientQuery.mock.calls.map(c => String(c[0]).split(' ')[0])
    expect(ops[0]).toBe('DELETE')
    expect(ops[1]).toBe('INSERT')
  })

  it('skips an unchanged file (same hash): no embedText, no delete/insert', async () => {
    setupGitlab({
      tree: { __root__: [{ type: 'blob', path: 'a.ts' }] },
      files: { 'a.ts': 'stable content' },
    })
    const { hashContent } = await import('./shared')
    const sameHash = hashContent('stable content')
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ content_hash: sameHash }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    const result = await indexRepositoryFiles({ projectId: 3 })

    expect(result.filesSkipped).toBe(1)
    expect(result.filesIndexed).toBe(0)
    expect(mockEmbedText).not.toHaveBeenCalled()
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('deletes orphans scoped to the project after indexing', async () => {
    setupGitlab({
      tree: { __root__: [{ type: 'blob', path: 'a.ts' }] },
      files: { 'a.ts': 'content a' },
    })

    await indexRepositoryFiles({ projectId: 3 })

    const orphanCall = mockQuery.mock.calls.find(c => String(c[0]).startsWith('DELETE'))
    expect(orphanCall).toBeDefined()
    expect(String(orphanCall![0])).toContain('project_id = $1')
    expect(String(orphanCall![0])).toContain('<> ALL($3::text[])')
    expect(orphanCall![1]).toEqual([3, 'code', ['a.ts']])
  })

  it('logs progress as (i/total)', async () => {
    setupGitlab({
      tree: { __root__: [{ type: 'blob', path: 'a.ts' }, { type: 'blob', path: 'b.ts' }] },
      files: { 'a.ts': 'aa', 'b.ts': 'bb' },
    })

    await indexRepositoryFiles({ projectId: 3 })

    const logged = mockLoggerInfo.mock.calls.flat().join('\n')
    expect(logged).toContain('(1/2)')
    expect(logged).toContain('(2/2)')
  })
})
