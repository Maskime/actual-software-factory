import { vi, describe, it, expect } from 'vitest'
import { GitLabApiError } from '../gitlab-client.js'
import type { GitLabClient } from '../gitlab-client.js'
import {
  handleGetIssue,
  handleListIssues,
  handleCreateIssue,
  handleUpdateIssue,
  handleCloseIssue,
  handleCreateIssueLink,
  handleGetIssueLinks,
  handleGetIssueComments,
} from './issues.js'

vi.mock('./uploads.js', () => ({
  uploadFileRaw: vi.fn().mockResolvedValue({
    url: '/uploads/abc/file.png',
    markdown: '![file.png](/uploads/abc/file.png)',
    full_path: '/root/sf/uploads/abc/file.png',
  }),
}))

import { uploadFileRaw } from './uploads.js'

const baseIssue = {
  id: 10, iid: 1, title: 'Bug', description: 'desc', state: 'opened' as const,
  labels: ['bug'], assignees: [], web_url: 'http://gl/issues/1',
}

describe('handleGetIssue()', () => {
  it('returns issue data on success', async () => {
    const client = { get: vi.fn().mockResolvedValue(baseIssue) } as unknown as GitLabClient
    const result = await handleGetIssue(client, { project_id: '3', issue_iid: 1 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.iid).toBe(1)
    expect(parsed.title).toBe('Bug')
    expect(parsed.state).toBe('opened')
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleGetIssue(client, { project_id: '3', issue_iid: 99 })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})

describe('handleListIssues()', () => {
  it('returns list of issues on success', async () => {
    const client = { get: vi.fn().mockResolvedValue([baseIssue]) } as unknown as GitLabClient
    const result = await handleListIssues(client, { project_id: '3' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].iid).toBe(1)
  })

  it('passes state, labels, assignee_username and page params', async () => {
    const mockGet = vi.fn().mockResolvedValue([])
    const client = { get: mockGet } as unknown as GitLabClient
    await handleListIssues(client, { project_id: '3', state: 'closed', labels: 'bug', assignee_username: 'alice', page: 2 })
    const params = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(params.state).toBe('closed')
    expect(params.labels).toBe('bug')
    expect(params.assignee_username).toBe('alice')
    expect(params.page).toBe(2)
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleListIssues(client, { project_id: '3' })
    expect(result.isError).toBe(true)
  })
})

describe('handleCreateIssue()', () => {
  it('returns iid, id and web_url on success', async () => {
    const client = { post: vi.fn().mockResolvedValue(baseIssue) } as unknown as GitLabClient
    const result = await handleCreateIssue(client, { project_id: '3', title: 'Bug' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.iid).toBe(1)
    expect(parsed.id).toBe(10)
    expect(parsed.web_url).toBeTruthy()
  })

  it('includes optional description and labels in body', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateIssue(client, { project_id: '3', title: 'Bug', description: 'desc', labels: 'bug,urgent' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.description).toBe('desc')
    expect(body.labels).toBe('bug,urgent')
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleCreateIssue(client, { project_id: '3', title: 'Bug' })
    expect(result.isError).toBe(true)
  })

  it('uploads attachments and appends markdown snippets to description', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost, postMultipart: vi.fn() } as unknown as GitLabClient
    await handleCreateIssue(client, {
      project_id: '3',
      title: 'Bug with screenshot',
      description: 'Initial desc',
      attachments: ['/tmp/shot.png', '/tmp/log.txt'],
    })
    expect(uploadFileRaw).toHaveBeenCalledTimes(2)
    expect(uploadFileRaw).toHaveBeenCalledWith(client, { project_id: '3', file_path: '/tmp/shot.png' })
    expect(uploadFileRaw).toHaveBeenCalledWith(client, { project_id: '3', file_path: '/tmp/log.txt' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.description).toContain('Initial desc')
    expect(body.description).toContain('![file.png](/uploads/abc/file.png)')
  })

  it('creates issue without attachments when attachments is undefined', async () => {
    vi.mocked(uploadFileRaw).mockClear()
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateIssue(client, { project_id: '3', title: 'Bug' })
    expect(uploadFileRaw).not.toHaveBeenCalled()
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.description).toBeUndefined()
  })

  it('sets description from attachment markdown when no initial description is provided', async () => {
    vi.mocked(uploadFileRaw).mockClear()
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost, postMultipart: vi.fn() } as unknown as GitLabClient
    await handleCreateIssue(client, {
      project_id: '3',
      title: 'Bug',
      attachments: ['/tmp/shot.png'],
    })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.description).toBe('![file.png](/uploads/abc/file.png)')
  })
})

describe('handleUpdateIssue()', () => {
  it('returns updated issue on success', async () => {
    const updated = { ...baseIssue, title: 'Fixed bug', state: 'closed' as const }
    const client = { put: vi.fn().mockResolvedValue(updated) } as unknown as GitLabClient
    const result = await handleUpdateIssue(client, { project_id: '3', issue_iid: 1, title: 'Fixed bug', state_event: 'close' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.title).toBe('Fixed bug')
    expect(parsed.state).toBe('closed')
  })

  it('returns errorResponse on API error', async () => {
    const client = { put: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleUpdateIssue(client, { project_id: '3', issue_iid: 1 })
    expect(result.isError).toBe(true)
  })
})

describe('handleCloseIssue()', () => {
  it('returns closed: true when state is closed', async () => {
    const client = { put: vi.fn().mockResolvedValue({ ...baseIssue, state: 'closed' }) } as unknown as GitLabClient
    const result = await handleCloseIssue(client, { project_id: '3', issue_iid: 1 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.closed).toBe(true)
    expect(parsed.state).toBe('closed')
  })

  it('returns errorResponse on API error', async () => {
    const client = { put: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleCloseIssue(client, { project_id: '3', issue_iid: 1 })
    expect(result.isError).toBe(true)
  })
})

describe('handleCreateIssueLink()', () => {
  const baseLink = {
    source_issue: { iid: 1, web_url: 'http://gl/issues/1' },
    target_issue: { iid: 2, web_url: 'http://gl/issues/2' },
    link_type: 'relates_to',
  }

  it('returns source_issue_iid, target_issue_iid and link_type on success', async () => {
    const client = { post: vi.fn().mockResolvedValue(baseLink) } as unknown as GitLabClient
    const result = await handleCreateIssueLink(client, { project_id: '3', issue_iid: 1, target_project_id: '3', target_issue_iid: 2 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.source_issue_iid).toBe(1)
    expect(parsed.target_issue_iid).toBe(2)
    expect(parsed.link_type).toBe('relates_to')
    expect(parsed.source_url).toBeTruthy()
    expect(parsed.target_url).toBeTruthy()
  })

  it('includes link_type in body when provided', async () => {
    const mockPost = vi.fn().mockResolvedValue({ ...baseLink, link_type: 'blocks' })
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateIssueLink(client, { project_id: '3', issue_iid: 1, target_project_id: '3', target_issue_iid: 2, link_type: 'blocks' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.link_type).toBe('blocks')
  })

  it('omits link_type from body when not provided', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseLink)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateIssueLink(client, { project_id: '3', issue_iid: 1, target_project_id: '3', target_issue_iid: 2 })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.link_type).toBeUndefined()
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('fail', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleCreateIssueLink(client, { project_id: '3', issue_iid: 1, target_project_id: '3', target_issue_iid: 99 })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})

describe('handleGetIssueLinks()', () => {
  const linkedIssue = {
    iid: 10,
    title: 'Blocking task',
    state: 'opened' as const,
    web_url: 'http://gl/issues/10',
    link_type: 'blocks' as const,
    issue_link_id: 42,
  }

  it('returns empty array when no links exist', async () => {
    const client = { get: vi.fn().mockResolvedValue([]) } as unknown as GitLabClient
    const result = await handleGetIssueLinks(client, { project_id: '3', issue_iid: 5 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(0)
  })

  it('returns link with type blocks', async () => {
    const client = { get: vi.fn().mockResolvedValue([linkedIssue]) } as unknown as GitLabClient
    const result = await handleGetIssueLinks(client, { project_id: '3', issue_iid: 5 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].source_iid).toBe(5)
    expect(parsed[0].target_iid).toBe(10)
    expect(parsed[0].link_type).toBe('blocks')
    expect(parsed[0].title).toBe('Blocking task')
    expect(parsed[0].state).toBe('opened')
    expect(parsed[0].web_url).toBe('http://gl/issues/10')
  })

  it('returns link with type is_blocked_by', async () => {
    const blockedByIssue = { ...linkedIssue, iid: 3, link_type: 'is_blocked_by' as const }
    const client = { get: vi.fn().mockResolvedValue([blockedByIssue]) } as unknown as GitLabClient
    const result = await handleGetIssueLinks(client, { project_id: '3', issue_iid: 5 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed[0].link_type).toBe('is_blocked_by')
    expect(parsed[0].source_iid).toBe(5)
    expect(parsed[0].target_iid).toBe(3)
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleGetIssueLinks(client, { project_id: '3', issue_iid: 99 })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})

describe('handleGetIssueComments()', () => {
  const humanNote = { id: 1, body: 'Nice work', author: { id: 10, username: 'alice', name: 'Alice' }, created_at: '2024-01-01T00:00:00Z', system: false }
  const systemNote = { id: 2, body: 'closed by commit abc', author: { id: 0, username: 'gitlab-bot', name: 'GitLab Bot' }, created_at: '2024-01-02T00:00:00Z', system: true }

  it('returns only human notes by default and maps fields correctly', async () => {
    const client = { get: vi.fn().mockResolvedValue([humanNote, systemNote]) } as unknown as GitLabClient
    const result = await handleGetIssueComments(client, { project_id: '3', issue_iid: 1 })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual({ id: 1, author: 'alice', body: 'Nice work', created_at: '2024-01-01T00:00:00Z' })
    expect(parsed[0].system).toBeUndefined()
    expect(parsed[0].author_id).toBeUndefined()
  })

  it('returns all notes when include_system_notes is true', async () => {
    const client = { get: vi.fn().mockResolvedValue([humanNote, systemNote]) } as unknown as GitLabClient
    const result = await handleGetIssueComments(client, { project_id: '3', issue_iid: 1, include_system_notes: true })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(2)
  })

  it('passes per_page and sort params to client', async () => {
    const mockGet = vi.fn().mockResolvedValue([])
    const client = { get: mockGet } as unknown as GitLabClient
    await handleGetIssueComments(client, { project_id: '3', issue_iid: 1 })
    const queryParams = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(queryParams.per_page).toBe(100)
    expect(queryParams.sort).toBe('asc')
  })

  it('returns errorResponse when issue does not exist', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleGetIssueComments(client, { project_id: '3', issue_iid: 99 })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})
