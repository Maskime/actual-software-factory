import { vi, describe, it, expect } from 'vitest'
import { GitLabApiError } from '../gitlab-client.js'
import type { GitLabClient } from '../gitlab-client.js'
import {
  handleListVariables,
  handleGetVariable,
  handleCreateVariable,
  handleUpdateVariable,
  handleDeleteVariable,
} from './variables.js'

const baseVariable = {
  key: 'MY_SECRET',
  value: 's3cr3t-value',
  variable_type: 'env_var',
  protected: false,
  masked: true,
  raw: false,
  environment_scope: '*',
  description: 'a secret',
}

describe('handleListVariables()', () => {
  it('returns metadata without value on success and requests per_page=100', async () => {
    const mockGet = vi.fn().mockResolvedValue([baseVariable])
    const client = { get: mockGet } as unknown as GitLabClient
    const result = await handleListVariables(client, { project_id: '3' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].key).toBe('MY_SECRET')
    expect(parsed[0].value).toBeUndefined()
    expect(parsed[0].masked).toBe(true)
    expect(mockGet.mock.calls[0][1]).toEqual({ per_page: 100 })
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('fail', 500, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleListVariables(client, { project_id: '3' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_API_ERROR')
  })
})

describe('handleGetVariable()', () => {
  it('returns metadata without value on success', async () => {
    const client = { get: vi.fn().mockResolvedValue(baseVariable) } as unknown as GitLabClient
    const result = await handleGetVariable(client, { project_id: '3', key: 'MY_SECRET' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.key).toBe('MY_SECRET')
    expect(parsed.value).toBeUndefined()
  })

  it('passes filter[environment_scope] as the get params when environment_scope is provided', async () => {
    const mockGet = vi.fn().mockResolvedValue(baseVariable)
    const client = { get: mockGet } as unknown as GitLabClient
    await handleGetVariable(client, { project_id: '3', key: 'MY_SECRET', environment_scope: 'production' })
    expect(mockGet.mock.calls[0][1]).toEqual({ 'filter[environment_scope]': 'production' })
  })

  it('passes no params when environment_scope is omitted', async () => {
    const mockGet = vi.fn().mockResolvedValue(baseVariable)
    const client = { get: mockGet } as unknown as GitLabClient
    await handleGetVariable(client, { project_id: '3', key: 'MY_SECRET' })
    expect(mockGet.mock.calls[0][1]).toBeUndefined()
  })

  it('returns errorResponse on API error', async () => {
    const client = { get: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleGetVariable(client, { project_id: '3', key: 'MISSING' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})

describe('handleCreateVariable()', () => {
  it('returns metadata without value on success', async () => {
    const client = { post: vi.fn().mockResolvedValue(baseVariable) } as unknown as GitLabClient
    const result = await handleCreateVariable(client, { project_id: '3', key: 'MY_SECRET', value: 's3cr3t-value' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.key).toBe('MY_SECRET')
    expect(parsed.value).toBeUndefined()
  })

  it('includes provided options in the post body and omits absent fields', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseVariable)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateVariable(client, {
      project_id: '3',
      key: 'MY_SECRET',
      value: 's3cr3t-value',
      variable_type: 'file',
      masked: true,
      environment_scope: 'production',
    })
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.key).toBe('MY_SECRET')
    expect(body.value).toBe('s3cr3t-value')
    expect(body.variable_type).toBe('file')
    expect(body.masked).toBe(true)
    expect(body.environment_scope).toBe('production')
    expect(body.protected).toBeUndefined()
    expect(body.raw).toBeUndefined()
    expect(body.description).toBeUndefined()
  })

  it('targets the project variables endpoint', async () => {
    const mockPost = vi.fn().mockResolvedValue(baseVariable)
    const client = { post: mockPost } as unknown as GitLabClient
    await handleCreateVariable(client, { project_id: '3', key: 'MY_SECRET', value: 'v' })
    expect(mockPost.mock.calls[0][0]).toBe('/projects/3/variables')
  })

  it('returns errorResponse on API error', async () => {
    const client = { post: vi.fn().mockRejectedValue(new GitLabApiError('fail', 400, 'GITLAB_API_ERROR')) } as unknown as GitLabClient
    const result = await handleCreateVariable(client, { project_id: '3', key: 'MY_SECRET', value: 'v' })
    expect(result.isError).toBe(true)
  })
})

describe('handleUpdateVariable()', () => {
  it('returns metadata without value on success and calls put with the right path', async () => {
    const mockPut = vi.fn().mockResolvedValue(baseVariable)
    const client = { put: mockPut } as unknown as GitLabClient
    const result = await handleUpdateVariable(client, { project_id: '3', key: 'MY_SECRET', value: 'new' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.value).toBeUndefined()
    expect(mockPut.mock.calls[0][0]).toBe('/projects/3/variables/MY_SECRET')
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>
    expect(body.value).toBe('new')
    expect(body.key).toBeUndefined()
  })

  it('encodes filter[environment_scope] in the path and keeps environment_scope (new scope) in the body', async () => {
    const mockPut = vi.fn().mockResolvedValue(baseVariable)
    const client = { put: mockPut } as unknown as GitLabClient
    await handleUpdateVariable(client, {
      project_id: '3',
      key: 'MY_SECRET',
      value: 'new',
      environment_scope: 'production',
      filter_environment_scope: 'staging',
    })
    const path = mockPut.mock.calls[0][0] as string
    expect(path).toContain('filter%5Benvironment_scope%5D')
    const body = mockPut.mock.calls[0][1] as Record<string, unknown>
    expect(body.key).toBeUndefined()
    expect(body.filter_environment_scope).toBeUndefined()
    expect(body.environment_scope).toBe('production')
  })

  it('returns errorResponse on API error', async () => {
    const client = { put: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleUpdateVariable(client, { project_id: '3', key: 'MISSING', value: 'v' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})

describe('handleDeleteVariable()', () => {
  it('calls delete with the right path and returns deleted: true', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const client = { delete: mockDelete } as unknown as GitLabClient
    const result = await handleDeleteVariable(client, { project_id: '3', key: 'MY_SECRET' })
    expect(mockDelete.mock.calls[0][0]).toBe('/projects/3/variables/MY_SECRET')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.deleted).toBe(true)
    expect(parsed.key).toBe('MY_SECRET')
  })

  it('encodes filter[environment_scope] in the path when environment_scope is provided', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const client = { delete: mockDelete } as unknown as GitLabClient
    await handleDeleteVariable(client, { project_id: '3', key: 'MY_SECRET', environment_scope: 'production' })
    const path = mockDelete.mock.calls[0][0] as string
    expect(path).toContain('filter%5Benvironment_scope%5D')
  })

  it('returns errorResponse on API error', async () => {
    const client = { delete: vi.fn().mockRejectedValue(new GitLabApiError('not found', 404, 'GITLAB_NOT_FOUND')) } as unknown as GitLabClient
    const result = await handleDeleteVariable(client, { project_id: '3', key: 'MISSING' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error.code).toBe('GITLAB_NOT_FOUND')
  })
})
