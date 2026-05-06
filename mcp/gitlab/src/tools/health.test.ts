import { vi, describe, it, expect } from 'vitest'
import { GitLabAuthError } from '../gitlab-client.js'
import type { GitLabClient } from '../gitlab-client.js'
import { handleCheckAuth } from './health.js'

describe('handleCheckAuth()', () => {
  it('returns authenticated: true with user info on success', async () => {
    const user = { id: 1, username: 'alice', name: 'Alice' }
    const client = { validateAuth: vi.fn().mockResolvedValue(user) } as unknown as GitLabClient
    const result = await handleCheckAuth(client)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.authenticated).toBe(true)
    expect(parsed.user.username).toBe('alice')
  })

  it('returns isError with message on GitLabAuthError', async () => {
    const client = { validateAuth: vi.fn().mockRejectedValue(new GitLabAuthError('token invalid', 401)) } as unknown as GitLabClient
    const result = await handleCheckAuth(client)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('token invalid')
  })

  it('converts non-Error thrown values to string', async () => {
    const client = { validateAuth: vi.fn().mockRejectedValue('raw error') } as unknown as GitLabClient
    const result = await handleCheckAuth(client)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('raw error')
  })
})
