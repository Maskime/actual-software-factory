import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPoolQuery = vi.fn()
const mockConnect = vi.fn()
const PoolMock = vi.fn(() => ({ query: mockPoolQuery, connect: mockConnect }))

vi.mock('pg', () => ({ Pool: PoolMock }))

describe('db', () => {
  const origNuxt = process.env.NUXT_DATABASE_URL
  const origDb = process.env.DATABASE_URL

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.NUXT_DATABASE_URL = 'postgres://u:p@localhost:5432/db'
    delete process.env.DATABASE_URL
  })

  afterEach(() => {
    process.env.NUXT_DATABASE_URL = origNuxt
    process.env.DATABASE_URL = origDb
  })

  it('throws when no connection string is configured', async () => {
    delete process.env.NUXT_DATABASE_URL
    delete process.env.DATABASE_URL
    const { getPool } = await import('./db')
    expect(() => getPool()).toThrow('NUXT_DATABASE_URL')
  })

  it('creates a single pool (singleton) from the connection string', async () => {
    const { getPool } = await import('./db')
    const p1 = getPool()
    const p2 = getPool()
    expect(p1).toBe(p2)
    expect(PoolMock).toHaveBeenCalledTimes(1)
    expect(PoolMock).toHaveBeenCalledWith({ connectionString: 'postgres://u:p@localhost:5432/db' })
  })

  it('falls back to DATABASE_URL when NUXT_DATABASE_URL is absent', async () => {
    delete process.env.NUXT_DATABASE_URL
    process.env.DATABASE_URL = 'postgres://fallback@localhost:5432/db'
    const { getPool } = await import('./db')
    getPool()
    expect(PoolMock).toHaveBeenCalledWith({ connectionString: 'postgres://fallback@localhost:5432/db' })
  })

  it('query delegates to the pool', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ a: 1 }], rowCount: 1 })
    const { query } = await import('./db')
    const res = await query('SELECT 1', [1])
    expect(mockPoolQuery).toHaveBeenCalledWith('SELECT 1', [1])
    expect(res.rows).toEqual([{ a: 1 }])
  })

  it('withClient acquires a client and releases it', async () => {
    const release = vi.fn()
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] })
    mockConnect.mockResolvedValue({ query: clientQuery, release })
    const { withClient } = await import('./db')

    const result = await withClient(async (c) => {
      await c.query('X')
      return 'done'
    })

    expect(result).toBe('done')
    expect(clientQuery).toHaveBeenCalledWith('X')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases the client even when the callback throws', async () => {
    const release = vi.fn()
    mockConnect.mockResolvedValue({ query: vi.fn(), release })
    const { withClient } = await import('./db')

    await expect(withClient(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
