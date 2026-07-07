import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock the DB layer ---
const mockQuery = vi.fn()
vi.mock('./db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

import { getActivePrompt } from './prompts'

describe('getActivePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns the content of the active prompt when a row exists', async () => {
    mockQuery.mockResolvedValue({ rows: [{ content: 'plan prompt content' }] })
    const result = await getActivePrompt('dev-agent.plan')
    expect(result).toBe('plan prompt content')
  })

  it('returns null when no active version exists for the key', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    const result = await getActivePrompt('dev-agent.plan')
    expect(result).toBeNull()
  })

  it('queries with the agentKey and an is_active = TRUE filter', async () => {
    await getActivePrompt('review-agent.review')
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('is_active = TRUE')
    expect(String(sql)).toContain('agent_key = $1')
    expect(params).toEqual(['review-agent.review'])
  })
})
