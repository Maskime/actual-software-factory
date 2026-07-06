import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  readBody: vi.fn(),
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

vi.mock('#auth', () => ({
  getToken: vi.fn(),
}))

const mockIndexFiles = vi.fn()
vi.mock('../utils/indexer/files', () => ({
  indexRepositoryFiles: (...args: unknown[]) => mockIndexFiles(...args),
}))

const mockIndexIssues = vi.fn()
vi.mock('../utils/indexer/issues', () => ({
  indexProjectIssues: (...args: unknown[]) => mockIndexIssues(...args),
}))

vi.mock('consola', () => ({
  createConsola: () => ({
    withTag: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  }),
}))

import handler from './index.post'
import * as h3 from 'h3'
import * as auth from '#auth'

const mockEvent = {}

const filesResult = { filesIndexed: 2, filesSkipped: 0, chunksUpserted: 5 }
const issuesResult = { issuesIndexed: 1, issuesSkipped: 0, chunksUpserted: 1 }

describe('index.post handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({
      gitlabProjectId: '',
      mcpGitlabUrl: 'http://mcp:3000',
    }))
    mockIndexFiles.mockResolvedValue(filesResult)
    mockIndexIssues.mockResolvedValue(issuesResult)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when no token', async () => {
    vi.mocked(auth.getToken).mockResolvedValue(null)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3 })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 401 })
    expect(mockIndexFiles).not.toHaveBeenCalled()
  })

  it('returns 400 when no projectId and no gitlabProjectId', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({})

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockIndexFiles).not.toHaveBeenCalled()
  })

  it('indexes files then issues and aggregates the result', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3 })

    const result = await (handler as Function)(mockEvent)

    expect(mockIndexFiles).toHaveBeenCalledWith({ projectId: 3, mcpGitlabUrl: 'http://mcp:3000' })
    expect(mockIndexIssues).toHaveBeenCalledWith({ projectId: 3, mcpGitlabUrl: 'http://mcp:3000' })
    expect(result.indexed).toBe(6)
    expect(typeof result.duration_ms).toBe('number')
  })

  it('prefers config.gitlabProjectId over the body projectId', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({
      gitlabProjectId: '42',
      mcpGitlabUrl: 'http://mcp:3000',
    }))
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3 })

    await (handler as Function)(mockEvent)

    expect(mockIndexFiles).toHaveBeenCalledWith({ projectId: 42, mcpGitlabUrl: 'http://mcp:3000' })
  })

  it('returns 502 when an indexer throws', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3 })
    mockIndexFiles.mockRejectedValue(new Error('boom'))

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 502 })
  })
})
