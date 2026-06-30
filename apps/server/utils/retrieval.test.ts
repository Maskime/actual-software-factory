import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock the embedding layer ---
const mockEmbedText = vi.fn()
vi.mock('./embedding', () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}))

// --- Mock the DB layer ---
const mockQuery = vi.fn()
vi.mock('./db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

import { retrieveContext, formatContextBlock } from './retrieval'

describe('retrieveContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedText.mockResolvedValue([Array.from({ length: 1024 }, () => 0.1)])
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns [] for empty query without calling embed/query', async () => {
    const result = await retrieveContext(3, '   ')
    expect(result).toEqual([])
    expect(mockEmbedText).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns [] when embed yields no vector', async () => {
    mockEmbedText.mockResolvedValue([])
    const result = await retrieveContext(3, 'hello')
    expect(result).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('runs a project-scoped cosine search with default limit 8', async () => {
    await retrieveContext(3, 'composant FooBar')

    expect(mockEmbedText).toHaveBeenCalledWith(['composant FooBar'])
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('embedding <=>')
    expect(String(sql)).toContain('WHERE project_id = $1')
    expect(String(sql)).toContain('LIMIT')
    expect(params[0]).toBe(3)
    expect(params[1]).toMatch(/^\[0\.1,/)
    expect(params[2]).toBe(8)
  })

  it('respects a custom limit', async () => {
    await retrieveContext(7, 'query', 3)
    const [, params] = mockQuery.mock.calls[0]
    expect(params[0]).toBe(7)
    expect(params[2]).toBe(3)
  })

  it('maps snake_case columns to camelCase fields', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { source_type: 'code', source_path: 'app/foo.ts', content: 'bar' },
        { source_type: 'issue', source_path: '#12 Title', content: 'baz' },
      ],
    })

    const result = await retrieveContext(3, 'query')
    expect(result).toEqual([
      { sourceType: 'code', sourcePath: 'app/foo.ts', content: 'bar' },
      { sourceType: 'issue', sourcePath: '#12 Title', content: 'baz' },
    ])
  })
})

describe('formatContextBlock', () => {
  it('returns null for an empty list', () => {
    expect(formatContextBlock([])).toBeNull()
  })

  it('produces a block with the header and source/path separators', () => {
    const block = formatContextBlock([
      { sourceType: 'code', sourcePath: 'app/foo.ts', content: 'const a = 1' },
    ])
    expect(block).not.toBeNull()
    expect(block!).toContain('[Contexte projet — extraits pertinents]')
    expect(block!).toContain('code')
    expect(block!).toContain('app/foo.ts')
    expect(block!).toContain('const a = 1')
  })
})
