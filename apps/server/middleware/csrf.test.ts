import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  getMethod: vi.fn(),
  getRequestURL: vi.fn(),
  getHeader: vi.fn(),
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

vi.mock('consola', () => ({
  createConsola: () => ({
    withTag: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }),
}))

import handler from './csrf'
import * as h3 from 'h3'

const event = {}

function setMethod(method: string): void {
  vi.mocked(h3.getMethod).mockReturnValue(method)
}

function setUrl(pathname: string): void {
  vi.mocked(h3.getRequestURL).mockReturnValue(new URL('http://localhost:3000' + pathname) as any)
}

function setHeaders(headers: { origin?: string; referer?: string }): void {
  vi.mocked(h3.getHeader).mockImplementation((_event: unknown, name: string) => {
    if (name === 'origin') return headers.origin
    if (name === 'referer') return headers.referer
    return undefined
  })
}

describe('csrf middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({ csrfTrustedOrigins: '' }))
    setHeaders({})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not throw for GET', () => {
    setMethod('GET')
    setUrl('/api/anything')
    expect(() => (handler as Function)(event)).not.toThrow()
  })

  it('does not throw for HEAD', () => {
    setMethod('HEAD')
    setUrl('/api/anything')
    expect(() => (handler as Function)(event)).not.toThrow()
  })

  it('does not throw for OPTIONS', () => {
    setMethod('OPTIONS')
    setUrl('/api/anything')
    expect(() => (handler as Function)(event)).not.toThrow()
  })

  it('does not throw for POST to /api/auth/callback/gitlab without Origin (NextAuth excluded)', () => {
    setMethod('POST')
    setUrl('/api/auth/callback/gitlab')
    expect(() => (handler as Function)(event)).not.toThrow()
  })

  it('throws 403 for POST to /api/authXYZ cross-origin (exact boundary, not excluded)', () => {
    setMethod('POST')
    setUrl('/api/authXYZ')
    setHeaders({ origin: 'http://evil.test' })
    expect(() => (handler as Function)(event)).toThrow()
    try {
      ;(handler as Function)(event)
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
  })

  it('does not throw for POST same-origin', () => {
    setMethod('POST')
    setUrl('/api/submit')
    setHeaders({ origin: 'http://localhost:3000' })
    expect(() => (handler as Function)(event)).not.toThrow()
  })

  it('throws 403 for POST cross-origin', () => {
    setMethod('POST')
    setUrl('/api/submit')
    setHeaders({ origin: 'http://evil.test' })
    expect(() => (handler as Function)(event)).toThrow()
    try {
      ;(handler as Function)(event)
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
  })

  it('throws 403 for POST without Origin nor Referer', () => {
    setMethod('POST')
    setUrl('/api/submit')
    setHeaders({})
    try {
      ;(handler as Function)(event)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
  })

  it('throws 403 for POST with literal Origin "null"', () => {
    setMethod('POST')
    setUrl('/api/submit')
    setHeaders({ origin: 'null' })
    try {
      ;(handler as Function)(event)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
  })

  it('does not throw for POST with a configured trusted origin', () => {
    setMethod('POST')
    setUrl('/api/submit')
    vi.stubGlobal(
      'useRuntimeConfig',
      vi.fn().mockReturnValue({ csrfTrustedOrigins: 'https://portal.example.com' }),
    )
    setHeaders({ origin: 'https://portal.example.com' })
    expect(() => (handler as Function)(event)).not.toThrow()
  })

  it('does not throw for POST without Origin but same-origin Referer (fallback)', () => {
    setMethod('POST')
    setUrl('/api/submit')
    setHeaders({ referer: 'http://localhost:3000/page' })
    expect(() => (handler as Function)(event)).not.toThrow()
  })
})
