import { vi, describe, it, expect, beforeEach } from 'vitest'
import { GitLabApiError } from '../gitlab-client.js'
import type { GitLabClient } from '../gitlab-client.js'
import {
  handleCreateBranch,
  handleListBranches,
  handleCommitFiles,
  handleGetFile,
  handleDeleteBranch,
  handleGetRepositoryTree,
} from './branches.js'

function makeMockClient(): { post: ReturnType<typeof vi.fn> } {
  return { post: vi.fn() }
}

const baseParams = {
  project_id: '3',
  branch: 'main',
  commit_message: 'test commit',
}

describe('handleCommitFiles() — validation', () => {
  it('returns INVALID_PARAMS when action is create without content', async () => {
    const client = makeMockClient()
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'create', file_path: 'foo.ts' }],
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('INVALID_PARAMS')
    expect(parsed.error.message).toContain('create')
    expect(client.post).not.toHaveBeenCalled()
  })

  it('returns INVALID_PARAMS when action is update without content', async () => {
    const client = makeMockClient()
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'update', file_path: 'foo.ts' }],
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('INVALID_PARAMS')
    expect(parsed.error.message).toContain('update')
  })

  it('passes validation for delete action without content', async () => {
    const client = makeMockClient()
    client.post.mockResolvedValue({
      id: 'sha1', short_id: 'sha1', title: 'test commit', author_name: 'Alice', created_at: '2026-01-01',
    })
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'delete', file_path: 'foo.ts' }],
    })
    expect(result.isError).toBeUndefined()
    expect(client.post).toHaveBeenCalled()
  })

  it('returns INVALID_PARAMS when action is move without previous_path', async () => {
    const client = makeMockClient()
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'move', file_path: 'new.ts' }],
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('INVALID_PARAMS')
    expect(client.post).not.toHaveBeenCalled()
  })

  it('passes validation for move action with previous_path', async () => {
    const client = makeMockClient()
    client.post.mockResolvedValue({
      id: 'sha1', short_id: 'sha1', title: 'test commit', author_name: 'Alice', created_at: '2026-01-01',
    })
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'move', file_path: 'new.ts', previous_path: 'old.ts' }],
    })
    expect(result.isError).toBeUndefined()
  })
})

describe('handleCommitFiles() — payload transformation', () => {
  let client: ReturnType<typeof makeMockClient>

  beforeEach(() => {
    client = makeMockClient()
    client.post.mockResolvedValue({
      id: 'sha1', short_id: 'sha1', title: 'test commit', author_name: 'Alice', created_at: '2026-01-01',
    })
  })

  it('encodes content as base64 for create action', async () => {
    await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'create', file_path: 'hello.txt', content: 'hello' }],
    })
    const body = client.post.mock.calls[0][1] as { actions: Array<Record<string, unknown>> }
    const action = body.actions[0]
    expect(action.content).toBe('aGVsbG8=')
    expect(action.encoding).toBe('base64')
  })

  it('omits content and encoding keys for delete action', async () => {
    await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'delete', file_path: 'foo.ts' }],
    })
    const body = client.post.mock.calls[0][1] as { actions: Array<Record<string, unknown>> }
    const action = body.actions[0]
    expect(action.content).toBeUndefined()
    expect(action.encoding).toBeUndefined()
  })

  it('includes previous_path in payload for move action', async () => {
    await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'move', file_path: 'new.ts', previous_path: 'old.ts', content: 'x' }],
    })
    const body = client.post.mock.calls[0][1] as { actions: Array<Record<string, unknown>> }
    expect(body.actions[0].previous_path).toBe('old.ts')
  })

  it('returns GITLAB_COMMIT_ERROR on GitLabApiError 400', async () => {
    client.post.mockRejectedValue(new GitLabApiError('invalid action', 400, 'GITLAB_BAD_REQUEST'))
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'create', file_path: 'x.ts', content: 'y' }],
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_COMMIT_ERROR')
    expect(parsed.error.statusCode).toBe(400)
  })

  it('returns errorResponse on non-400 API error', async () => {
    client.post.mockRejectedValue(new GitLabApiError('server error', 500, 'GITLAB_API_ERROR'))
    const result = await handleCommitFiles(client as unknown as GitLabClient, {
      ...baseParams,
      actions: [{ action: 'create', file_path: 'x.ts', content: 'y' }],
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_API_ERROR')
  })
})

describe('handleCreateBranch()', () => {
  it('returns name and sha on success', async () => {
    const client = { post: vi.fn().mockResolvedValue({ name: 'feat', commit: { id: 'abc123', short_id: 'abc', title: 'init' } }) } as unknown as GitLabClient
    const result = await handleCreateBranch(client, { project_id: '3', branch: 'feat', ref: 'main' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.name).toBe('feat')
    expect(parsed.sha).toBe('abc123')
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleCreateBranch(client, { project_id: '3', branch: 'feat', ref: 'main' })
    expect(result.isError).toBe(true)
  })
})

describe('handleListBranches()', () => {
  it('returns branch list on success', async () => {
    const branches = [{ name: 'main', commit: { id: 'sha1', short_id: 's', title: 'init' }, protected: true }]
    const client = { get: vi.fn().mockResolvedValue(branches) } as unknown as GitLabClient
    const result = await handleListBranches(client, { project_id: '3' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('main')
    expect(parsed[0].protected).toBe(true)
  })

  it('passes search and page query params', async () => {
    const mockGet = vi.fn().mockResolvedValue([])
    const client = { get: mockGet } as unknown as GitLabClient
    await handleListBranches(client, { project_id: '3', search: 'feat', page: 2 })
    const params = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(params.search).toBe('feat')
    expect(params.page).toBe(2)
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleListBranches(client, { project_id: '3' })
    expect(result.isError).toBe(true)
  })
})

describe('handleGetFile()', () => {
  it('decodes base64 content and returns file info', async () => {
    const fileData = { file_name: 'hello.ts', file_path: 'src/hello.ts', size: 5, encoding: 'base64', content: Buffer.from('hello').toString('base64'), ref: 'main' }
    const client = { get: vi.fn().mockResolvedValue(fileData) } as unknown as GitLabClient
    const result = await handleGetFile(client, { project_id: '3', file_path: 'src/hello.ts', ref: 'main' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).toBe('hello')
    expect(parsed.file_name).toBe('hello.ts')
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleGetFile(client, { project_id: '3', file_path: 'missing.ts', ref: 'main' })
    expect(result.isError).toBe(true)
  })
})

describe('handleDeleteBranch()', () => {
  it('returns deleted: true on success', async () => {
    const client = { delete: vi.fn().mockResolvedValue(undefined) } as unknown as GitLabClient
    const result = await handleDeleteBranch(client, { project_id: '3', branch: 'old-feat' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.deleted).toBe(true)
    expect(parsed.branch).toBe('old-feat')
  })

  it('returns errorResponse on API error', async () => {
    const client = { delete: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleDeleteBranch(client, { project_id: '3', branch: 'old-feat' })
    expect(result.isError).toBe(true)
  })
})

describe('handleGetRepositoryTree()', () => {
  it('returns tree entries on success', async () => {
    const tree = [{ id: 'id1', name: 'src', type: 'tree', path: 'src', mode: '040000' }]
    const client = { get: vi.fn().mockResolvedValue(tree) } as unknown as GitLabClient
    const result = await handleGetRepositoryTree(client, { project_id: '3' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe('tree')
  })

  it('passes optional query params', async () => {
    const mockGet = vi.fn().mockResolvedValue([])
    const client = { get: mockGet } as unknown as GitLabClient
    await handleGetRepositoryTree(client, { project_id: '3', path: 'src', ref: 'main', recursive: true })
    const params = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(params.path).toBe('src')
    expect(params.ref).toBe('main')
    expect(params.recursive).toBe(true)
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleGetRepositoryTree(client, { project_id: '3' })
    expect(result.isError).toBe(true)
  })
})
