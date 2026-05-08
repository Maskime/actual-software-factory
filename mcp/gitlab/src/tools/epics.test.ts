import { vi, describe, it, expect } from 'vitest'
import { GitLabApiError } from '../gitlab-client.js'
import type { GitLabClient } from '../gitlab-client.js'
import { handleCreateEpic } from './epics.js'

const baseIssue = {
  id: 42,
  iid: 7,
  title: '[EPIC] Mon epic',
  web_url: 'http://gl/issues/7',
}

describe('handleCreateEpic()', () => {
  it('returns iid, id, title and web_url on success', async () => {
    const client = { post: vi.fn().mockResolvedValue(baseIssue) } as unknown as GitLabClient
    const result = await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.iid).toBe(7)
    expect(parsed.id).toBe(42)
    expect(parsed.title).toBe('[EPIC] Mon epic')
    expect(parsed.web_url).toBe('http://gl/issues/7')
  })

  it('prefixes title with [EPIC]', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.title).toBe('[EPIC] Mon epic')
  })

  it('uses qualification-interface label by default', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.labels).toBe('qualification-interface')
  })

  it('uses custom labels when provided', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateEpic(client, { project_id: '3', title: 'Mon epic', labels: 'epic,custom' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.labels).toBe('epic,custom')
  })

  it('includes description in body when provided', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateEpic(client, { project_id: '3', title: 'Mon epic', description: 'Desc complète' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.description).toBe('Desc complète')
  })

  it('omits description from body when not provided', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('description')
  })

  it('calls the correct GitLab issues endpoint', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseIssue)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    expect(mockPost.mock.calls[0][0]).toBe('/projects/3/issues')
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('forbidden', 403, 'GITLAB_AUTH_ERROR')) } as unknown as GitLabClient
    const result = await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_AUTH_ERROR')
  })

  it('returns errorResponse on generic error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new Error('network error')) } as unknown as GitLabClient
    const result = await handleCreateEpic(client, { project_id: '3', title: 'Mon epic' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('network error')
  })
})
