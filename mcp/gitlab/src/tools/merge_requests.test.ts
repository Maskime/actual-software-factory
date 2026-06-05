import { vi, describe, it, expect, beforeEach } from 'vitest'
import { GitLabApiError } from '../gitlab-client.js'
import type { GitLabClient } from '../gitlab-client.js'
import { projectPath, errorResponse } from './utils.js'
import {
  handleCreateMr,
  handleGetMr,
  handleGetMrDiff,
  handleAddMrComment,
  handleAddMrInlineComment,
  handleMergeMr,
  handleListMrs,
  handleCloseMr,
} from './merge_requests.js'

function makeMockClient(): { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> } {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn() }
}

describe('projectPath()', () => {
  it('formats a numeric project ID', () => {
    expect(projectPath('3')).toBe('/projects/3')
  })

  it('URL-encodes a namespace/project path', () => {
    expect(projectPath('namespace/project')).toBe('/projects/namespace%2Fproject')
  })

  it('encodes special characters', () => {
    expect(projectPath('org/my project')).toBe('/projects/org%2Fmy%20project')
  })
})

describe('errorResponse()', () => {
  it('wraps GitLabApiError with isError, code, statusCode and message', () => {
    const err = new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')
    const result = errorResponse(err)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
    expect(parsed.error.statusCode).toBe(404)
    expect(parsed.error.message).toBe('not found')
  })

  it('extracts message from a standard Error', () => {
    const result = errorResponse(new Error('something broke'))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('something broke')
  })

  it('converts arbitrary non-Error values with String()', () => {
    const result = errorResponse(42)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('42')
  })
})

describe('handleAddMrInlineComment()', () => {
  let mockClient: ReturnType<typeof makeMockClient>
  const baseParams = {
    project_id: '3',
    mr_iid: 1,
    body: 'comment',
    file_path: 'src/index.ts',
  }

  beforeEach(() => {
    mockClient = makeMockClient()
  })

  it('returns INVALID_PARAMS without HTTP call when both new_line and old_line are undefined', async () => {
    const result = await handleAddMrInlineComment(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('INVALID_PARAMS')
    expect(mockClient.get).not.toHaveBeenCalled()
  })

  it('passes validation when only new_line is defined', async () => {
    const diffRefs = { base_sha: 'abc', head_sha: 'def', start_sha: 'ghi' }
    mockClient.get.mockResolvedValue({ diff_refs: diffRefs })
    mockClient.post.mockResolvedValue({ id: 'disc-1', notes: [{ id: 10, body: 'comment' }] })
    const result = await handleAddMrInlineComment(mockClient as unknown as GitLabClient, {
      ...baseParams,
      new_line: 5,
    })
    expect(result.isError).toBeUndefined()
  })

  it('passes validation when only old_line is defined', async () => {
    const diffRefs = { base_sha: 'abc', head_sha: 'def', start_sha: 'ghi' }
    mockClient.get.mockResolvedValue({ diff_refs: diffRefs })
    mockClient.post.mockResolvedValue({ id: 'disc-1', notes: [{ id: 10, body: 'comment' }] })
    const result = await handleAddMrInlineComment(mockClient as unknown as GitLabClient, {
      ...baseParams,
      old_line: 3,
    })
    expect(result.isError).toBeUndefined()
  })

  it('returns GITLAB_NO_DIFF_REFS when MR has diff_refs: null', async () => {
    mockClient.get.mockResolvedValue({ diff_refs: null })
    const result = await handleAddMrInlineComment(mockClient as unknown as GitLabClient, {
      ...baseParams,
      new_line: 5,
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NO_DIFF_REFS')
  })

  it('builds position without old_line when only new_line is provided', async () => {
    const diffRefs = { base_sha: 'b', head_sha: 'h', start_sha: 's' }
    mockClient.get.mockResolvedValue({ diff_refs: diffRefs })
    mockClient.post.mockResolvedValue({ id: 'disc-1', notes: [{ id: 10, body: 'comment' }] })
    await handleAddMrInlineComment(mockClient as unknown as GitLabClient, {
      ...baseParams,
      new_line: 7,
    })
    const postedBody = mockClient.post.mock.calls[0][1] as { position: Record<string, unknown> }
    expect(postedBody.position.new_line).toBe(7)
    expect(postedBody.position.old_line).toBeUndefined()
  })

  it('builds position with both new_line and old_line when both are provided', async () => {
    const diffRefs = { base_sha: 'b', head_sha: 'h', start_sha: 's' }
    mockClient.get.mockResolvedValue({ diff_refs: diffRefs })
    mockClient.post.mockResolvedValue({ id: 'disc-1', notes: [{ id: 10, body: 'comment' }] })
    await handleAddMrInlineComment(mockClient as unknown as GitLabClient, {
      ...baseParams,
      new_line: 7,
      old_line: 4,
    })
    const postedBody = mockClient.post.mock.calls[0][1] as { position: Record<string, unknown> }
    expect(postedBody.position.new_line).toBe(7)
    expect(postedBody.position.old_line).toBe(4)
  })

  it('returns errorResponse on API error', async () => {
    mockClient.get.mockResolvedValue({ diff_refs: { base_sha: 'b', head_sha: 'h', start_sha: 's' } })
    mockClient.post.mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR'))
    const result = await handleAddMrInlineComment(mockClient as unknown as GitLabClient, {
      ...baseParams,
      new_line: 10,
    })
    expect(result.isError).toBe(true)
  })
})

describe('handleMergeMr()', () => {
  let mockClient: ReturnType<typeof makeMockClient>
  const baseParams = { project_id: '3', mr_iid: 1 }

  beforeEach(() => {
    mockClient = makeMockClient()
  })

  it('includes merge_when_pipeline_succeeds in body when true', async () => {
    mockClient.put.mockResolvedValue({ iid: 1, state: 'opened', merge_commit_sha: null, web_url: 'u' })
    await handleMergeMr(mockClient as unknown as GitLabClient, {
      ...baseParams,
      merge_when_pipeline_succeeds: true,
    })
    const body = mockClient.put.mock.calls[0][1] as Record<string, unknown>
    expect(body.merge_when_pipeline_succeeds).toBe(true)
  })

  it('does not include merge_when_pipeline_succeeds in body when false', async () => {
    mockClient.put.mockResolvedValue({ iid: 1, state: 'opened', merge_commit_sha: null, web_url: 'u' })
    await handleMergeMr(mockClient as unknown as GitLabClient, {
      ...baseParams,
      merge_when_pipeline_succeeds: false,
    })
    const body = mockClient.put.mock.calls[0][1] as Record<string, unknown>
    expect(body.merge_when_pipeline_succeeds).toBeUndefined()
  })

  it('returns merge_commit_sha when state is merged', async () => {
    mockClient.put.mockResolvedValue({ iid: 1, state: 'merged', merge_commit_sha: 'sha123', web_url: 'u' })
    const result = await handleMergeMr(mockClient as unknown as GitLabClient, baseParams)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.state).toBe('merged')
    expect(parsed.merge_commit_sha).toBe('sha123')
    expect(parsed.queued).toBeUndefined()
  })

  it('returns queued: true when state is opened', async () => {
    mockClient.put.mockResolvedValue({ iid: 1, state: 'opened', merge_commit_sha: null, web_url: 'u' })
    const result = await handleMergeMr(mockClient as unknown as GitLabClient, baseParams)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.queued).toBe(true)
  })

  it('returns GITLAB_MERGE_BLOCKED on GitLabApiError 405', async () => {
    mockClient.put.mockRejectedValue(new GitLabApiError('not allowed', 405, 'GITLAB_METHOD_NOT_ALLOWED'))
    const result = await handleMergeMr(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_MERGE_BLOCKED')
  })

  it('returns GITLAB_MERGE_BLOCKED on GitLabApiError 406', async () => {
    mockClient.put.mockRejectedValue(new GitLabApiError('not acceptable', 406, 'GITLAB_NOT_ACCEPTABLE'))
    const result = await handleMergeMr(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_MERGE_BLOCKED')
  })

  it('returns generic errorResponse on GitLabApiError with other status', async () => {
    mockClient.put.mockRejectedValue(new GitLabApiError('server error', 500, 'GITLAB_API_ERROR'))
    const result = await handleMergeMr(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_API_ERROR')
    expect(parsed.error.statusCode).toBe(500)
  })
})

describe('handleCreateMr()', () => {
  it('returns iid and web_url on success', async () => {
    const client = { post: vi.fn().mockResolvedValue({ iid: 5, web_url: 'http://gl/mr/5' }) } as unknown as GitLabClient
    const result = await handleCreateMr(client, { project_id: '3', source_branch: 'feat', target_branch: 'main', title: 'My MR' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.iid).toBe(5)
    expect(parsed.web_url).toBe('http://gl/mr/5')
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleCreateMr(client, { project_id: '3', source_branch: 'feat', target_branch: 'main', title: 'My MR' })
    expect(result.isError).toBe(true)
  })
})

describe('handleGetMr()', () => {
  it('returns MR details and filtered comments on success', async () => {
    const mr = { iid: 2, title: 'T', state: 'opened', labels: [], changes_count: '3', merge_status: 'can_be_merged', web_url: 'u', diff_refs: null }
    const notes = [
      { id: 1, body: 'hi', system: false, author: { id: 1, username: 'a', name: 'A' }, created_at: '2026-01-01' },
      { id: 2, body: 'sys', system: true, author: { id: 0, username: '', name: '' }, created_at: '2026-01-01' },
    ]
    const client = { get: vi.fn().mockResolvedValueOnce(mr).mockResolvedValueOnce(notes) } as unknown as GitLabClient
    const result = await handleGetMr(client, { project_id: '3', mr_iid: 2 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.iid).toBe(2)
    expect(parsed.comments).toHaveLength(1)
    expect(parsed.comments[0].body).toBe('hi')
  })

  it('includes position data for inline notes', async () => {
    const mr = { iid: 3, title: 'T', state: 'opened', labels: [], changes_count: '1', merge_status: 'can_be_merged', web_url: 'u', diff_refs: null }
    const position = { new_path: 'src/foo.ts', old_path: 'src/foo.ts', new_line: 42, old_line: null }
    const notes = [
      { id: 10, body: '[BLOQUANT] Null dereference', system: false, author: { id: 1, username: 'bot', name: 'Bot' }, created_at: '2026-01-01', position },
    ]
    const client = { get: vi.fn().mockResolvedValueOnce(mr).mockResolvedValueOnce(notes) } as unknown as GitLabClient
    const result = await handleGetMr(client, { project_id: '3', mr_iid: 3 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.comments[0].position).toEqual(position)
  })

  it('returns position: null for notes without position', async () => {
    const mr = { iid: 4, title: 'T', state: 'opened', labels: [], changes_count: '1', merge_status: 'can_be_merged', web_url: 'u', diff_refs: null }
    const notes = [
      { id: 11, body: 'general comment', system: false, author: { id: 1, username: 'a', name: 'A' }, created_at: '2026-01-01' },
    ]
    const client = { get: vi.fn().mockResolvedValueOnce(mr).mockResolvedValueOnce(notes) } as unknown as GitLabClient
    const result = await handleGetMr(client, { project_id: '3', mr_iid: 4 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.comments[0].position).toBeNull()
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleGetMr(client, { project_id: '3', mr_iid: 99 })
    expect(result.isError).toBe(true)
  })
})

describe('handleGetMrDiff()', () => {
  it('returns diff changes on success', async () => {
    const changes = { changes: [{ old_path: 'a.ts', new_path: 'a.ts', diff: '@@ ...', new_file: false, renamed_file: false, deleted_file: false }] }
    const client = { get: vi.fn().mockResolvedValue(changes) } as unknown as GitLabClient
    const result = await handleGetMrDiff(client, { project_id: '3', mr_iid: 1 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].old_path).toBe('a.ts')
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleGetMrDiff(client, { project_id: '3', mr_iid: 1 })
    expect(result.isError).toBe(true)
  })
})

describe('handleAddMrComment()', () => {
  it('returns note details on success', async () => {
    const note = { id: 7, body: 'looks good', author: { id: 1, username: 'a', name: 'A' }, created_at: '2026-01-01' }
    const client = { post: vi.fn().mockResolvedValue(note) } as unknown as GitLabClient
    const result = await handleAddMrComment(client, { project_id: '3', mr_iid: 1, body: 'looks good' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.id).toBe(7)
    expect(parsed.body).toBe('looks good')
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleAddMrComment(client, { project_id: '3', mr_iid: 1, body: 'text' })
    expect(result.isError).toBe(true)
  })
})

describe('handleListMrs()', () => {
  let mockClient: ReturnType<typeof makeMockClient>
  const fakeMrs = [
    { iid: 1, title: 'Fix bug', state: 'opened', source_branch: 'fix/bug', target_branch: 'main', labels: ['bug'], web_url: 'http://gl/mr/1' },
    { iid: 2, title: 'Add feat', state: 'opened', source_branch: 'feat/new', target_branch: 'main', labels: [], web_url: 'http://gl/mr/2' },
  ]

  beforeEach(() => {
    mockClient = makeMockClient()
    mockClient.get.mockResolvedValue(fakeMrs)
  })

  it('calls GET /merge_requests with per_page: 100 and returns mapped array', async () => {
    const result = await handleListMrs(mockClient as unknown as GitLabClient, { project_id: '3' })
    expect(result.isError).toBeUndefined()
    const [path, params] = mockClient.get.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe('/projects/3/merge_requests')
    expect(params.per_page).toBe(100)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ iid: 1, title: 'Fix bug', state: 'opened', source_branch: 'fix/bug', target_branch: 'main', labels: ['bug'], web_url: 'http://gl/mr/1' })
  })

  it('passes state filter when provided', async () => {
    await handleListMrs(mockClient as unknown as GitLabClient, { project_id: '3', state: 'closed' })
    const params = mockClient.get.mock.calls[0][1] as Record<string, unknown>
    expect(params.state).toBe('closed')
  })

  it('passes source_branch and target_branch filters when provided', async () => {
    await handleListMrs(mockClient as unknown as GitLabClient, { project_id: '3', source_branch: 'feat/x', target_branch: 'main' })
    const params = mockClient.get.mock.calls[0][1] as Record<string, unknown>
    expect(params.source_branch).toBe('feat/x')
    expect(params.target_branch).toBe('main')
  })

  it('does not include optional params in query when not provided', async () => {
    await handleListMrs(mockClient as unknown as GitLabClient, { project_id: '3' })
    const params = mockClient.get.mock.calls[0][1] as Record<string, unknown>
    expect(params.state).toBeUndefined()
    expect(params.source_branch).toBeUndefined()
    expect(params.target_branch).toBeUndefined()
    expect(params.labels).toBeUndefined()
    expect(params.page).toBeUndefined()
  })

  it('returns errorResponse on API error', async () => {
    mockClient.get.mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR'))
    const result = await handleListMrs(mockClient as unknown as GitLabClient, { project_id: '3' })
    expect(result.isError).toBe(true)
  })
})

describe('handleCloseMr()', () => {
  let mockClient: ReturnType<typeof makeMockClient>
  const baseParams = { project_id: '3', mr_iid: 5 }

  beforeEach(() => {
    mockClient = makeMockClient()
  })

  it('calls PUT with state_event: close and returns iid, state, web_url', async () => {
    mockClient.put.mockResolvedValue({ iid: 5, state: 'closed', web_url: 'http://gl/mr/5' })
    const result = await handleCloseMr(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBeUndefined()
    const [path, body] = mockClient.put.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe('/projects/3/merge_requests/5')
    expect(body.state_event).toBe('close')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ iid: 5, state: 'closed', web_url: 'http://gl/mr/5' })
  })

  it('returns GITLAB_MR_NOT_OPEN on GitLabApiError 405', async () => {
    mockClient.put.mockRejectedValue(new GitLabApiError('already closed', 405, 'GITLAB_METHOD_NOT_ALLOWED'))
    const result = await handleCloseMr(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_MR_NOT_OPEN')
    expect(parsed.error.statusCode).toBe(405)
  })

  it('returns generic errorResponse on other API errors', async () => {
    mockClient.put.mockRejectedValue(new GitLabApiError('server error', 500, 'GITLAB_API_ERROR'))
    const result = await handleCloseMr(mockClient as unknown as GitLabClient, baseParams)
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_API_ERROR')
    expect(parsed.error.statusCode).toBe(500)
  })
})
