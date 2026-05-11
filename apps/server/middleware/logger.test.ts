import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

vi.mock('consola', () => ({
  createConsola: vi.fn(() => ({
    withTag: vi.fn(() => mockLogger),
  })),
}))

let finishHandler: (() => void) | null = null

const mockRes = {
  on: vi.fn((event: string, handler: () => void) => {
    if (event === 'finish') finishHandler = handler
  }),
  statusCode: 200,
}

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  getMethod: vi.fn(() => 'GET'),
  getRequestURL: vi.fn(() => new URL('http://localhost/api/test')),
}))

describe('server/middleware/logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    finishHandler = null
    mockRes.statusCode = 200
    mockRes.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'finish') finishHandler = handler
    })
  })

  const makeEvent = () => ({
    node: { res: mockRes },
  })

  const loadHandler = async () => {
    const mod = await import('./logger')
    return mod.default as (event: unknown) => Promise<void>
  }

  it('logs info for 2xx responses', async () => {
    const handler = await loadHandler()
    mockRes.statusCode = 200
    await handler(makeEvent())
    finishHandler!()
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('GET /api/test 200'))
  })

  it('logs warn for 4xx responses', async () => {
    const handler = await loadHandler()
    mockRes.statusCode = 404
    await handler(makeEvent())
    finishHandler!()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('GET /api/test 404'))
  })

  it('logs error for 5xx responses', async () => {
    const handler = await loadHandler()
    mockRes.statusCode = 500
    await handler(makeEvent())
    finishHandler!()
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('GET /api/test 500'))
  })

  it('logs warn for 400 boundary', async () => {
    const handler = await loadHandler()
    mockRes.statusCode = 400
    await handler(makeEvent())
    finishHandler!()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('400'))
  })

  it('logs error for 500 boundary', async () => {
    const handler = await loadHandler()
    mockRes.statusCode = 500
    await handler(makeEvent())
    finishHandler!()
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('500'))
  })

  it('includes duration in log message', async () => {
    const handler = await loadHandler()
    mockRes.statusCode = 200
    await handler(makeEvent())
    finishHandler!()
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/\+\d+ms/))
  })
})
