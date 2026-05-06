import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'

const { mockHttpGet, mockHttpPut, mockHttpPost, mockHttpDelete, mockAxiosInstance, mockExponentialDelay, mockAxiosRetry } = vi.hoisted(() => {
  const mockHttpGet = vi.fn()
  const mockHttpPut = vi.fn()
  const mockHttpPost = vi.fn()
  const mockHttpDelete = vi.fn()
  const mockAxiosInstance = { get: mockHttpGet, put: mockHttpPut, post: mockHttpPost, delete: mockHttpDelete }
  const mockExponentialDelay = vi.fn().mockReturnValue(1000)
  const mockAxiosRetry = vi.fn()
  return { mockHttpGet, mockHttpPut, mockHttpPost, mockHttpDelete, mockAxiosInstance, mockExponentialDelay, mockAxiosRetry }
})

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockAxiosInstance) },
}))

vi.mock('axios-retry', () => ({
  default: Object.assign(mockAxiosRetry, { exponentialDelay: mockExponentialDelay }),
}))

import { GitLabClient, GitLabAuthError, GitLabApiError, getRetryDelay } from './gitlab-client.js'

function makeAxiosError(
  status?: number,
  data?: unknown,
  headers: Record<string, string> = {}
): AxiosError {
  const err = new Error('Request failed') as AxiosError
  err.isAxiosError = true
  err.name = 'AxiosError'
  if (status !== undefined) {
    err.response = {
      status,
      data: data ?? {},
      headers,
      config: { headers: {} } as InternalAxiosRequestConfig,
      statusText: String(status),
    }
  } else {
    err.response = undefined
  }
  return err
}

describe('GitLabClient', () => {
  let savedToken: string | undefined
  let savedUrl: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    savedToken = process.env.GITLAB_API_TOKEN
    savedUrl = process.env.GITLAB_API_URL
    process.env.GITLAB_API_TOKEN = 'test-token'
    process.env.GITLAB_API_URL = 'http://localhost/api/v4'
  })

  afterEach(() => {
    if (savedToken !== undefined) process.env.GITLAB_API_TOKEN = savedToken
    else delete process.env.GITLAB_API_TOKEN
    if (savedUrl !== undefined) process.env.GITLAB_API_URL = savedUrl
    else delete process.env.GITLAB_API_URL
  })

  describe('constructor', () => {
    it('throws if GITLAB_API_TOKEN is missing', () => {
      delete process.env.GITLAB_API_TOKEN
      expect(() => new GitLabClient()).toThrow('GITLAB_API_TOKEN')
    })

    it('throws if GITLAB_API_URL is missing', () => {
      delete process.env.GITLAB_API_URL
      expect(() => new GitLabClient()).toThrow('GITLAB_API_URL')
    })

    it('does not throw when both env vars are present', () => {
      expect(() => new GitLabClient()).not.toThrow()
    })
  })

  describe('validateAuth()', () => {
    let client: GitLabClient

    beforeEach(() => {
      client = new GitLabClient()
    })

    it('returns user on HTTP 200', async () => {
      mockHttpGet.mockResolvedValue({ data: { id: 1, username: 'alice', name: 'Alice' } })
      const user = await client.validateAuth()
      expect(user).toEqual({ id: 1, username: 'alice', name: 'Alice' })
    })

    it('throws GitLabAuthError with statusCode 401 on HTTP 401', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(401))
      await expect(client.validateAuth()).rejects.toMatchObject({
        name: 'GitLabAuthError',
        statusCode: 401,
      })
    })

    it('throws GitLabAuthError with statusCode 403 on HTTP 403', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(403))
      await expect(client.validateAuth()).rejects.toMatchObject({
        name: 'GitLabAuthError',
        statusCode: 403,
      })
    })

    it('throws generic GitLabAuthError on network error (no response)', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(undefined))
      const err = await client.validateAuth().catch((e) => e)
      expect(err).toBeInstanceOf(GitLabAuthError)
      expect(err.statusCode).toBeUndefined()
    })
  })

  describe('get() via wrapError', () => {
    let client: GitLabClient

    beforeEach(() => {
      client = new GitLabClient()
    })

    it('returns data on success', async () => {
      mockHttpGet.mockResolvedValue({ data: { id: 42 } })
      expect(await client.get('/test')).toEqual({ id: 42 })
    })

    it('throws GitLabApiError GITLAB_AUTH_ERROR on HTTP 401', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(401))
      await expect(client.get('/test')).rejects.toMatchObject({
        code: 'GITLAB_AUTH_ERROR',
        statusCode: 401,
      })
    })

    it('throws GitLabApiError GITLAB_AUTH_ERROR on HTTP 403', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(403))
      await expect(client.get('/test')).rejects.toMatchObject({
        code: 'GITLAB_AUTH_ERROR',
        statusCode: 403,
      })
    })

    it('throws GitLabApiError GITLAB_NOT_FOUND on HTTP 404', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(404))
      await expect(client.get('/test')).rejects.toMatchObject({
        code: 'GITLAB_NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws GitLabApiError GITLAB_RATE_LIMIT on HTTP 429', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(429))
      await expect(client.get('/test')).rejects.toMatchObject({
        code: 'GITLAB_RATE_LIMIT',
        statusCode: 429,
      })
    })

    it('throws GitLabApiError GITLAB_API_ERROR on HTTP 500', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(500))
      await expect(client.get('/test')).rejects.toMatchObject({
        code: 'GITLAB_API_ERROR',
        statusCode: 500,
      })
    })

    it('throws GitLabApiError GITLAB_API_ERROR when no response (status 0)', async () => {
      mockHttpGet.mockRejectedValue(makeAxiosError(undefined))
      await expect(client.get('/test')).rejects.toMatchObject({
        code: 'GITLAB_API_ERROR',
        statusCode: 0,
      })
    })
  })

  describe('post() via wrapError', () => {
    let client: GitLabClient

    beforeEach(() => {
      client = new GitLabClient()
    })

    it('returns data on success', async () => {
      mockHttpPost.mockResolvedValue({ data: { created: true } })
      expect(await client.post('/test', { foo: 1 })).toEqual({ created: true })
    })

    it('throws GitLabApiError on HTTP 422', async () => {
      mockHttpPost.mockRejectedValue(makeAxiosError(422))
      await expect(client.post('/test')).rejects.toMatchObject({
        code: 'GITLAB_API_ERROR',
        statusCode: 422,
      })
    })
  })

  describe('put() via wrapError', () => {
    let client: GitLabClient

    beforeEach(() => {
      client = new GitLabClient()
    })

    it('returns data on success', async () => {
      mockHttpPut.mockResolvedValue({ data: { updated: true } })
      expect(await client.put('/test', { foo: 1 })).toEqual({ updated: true })
    })

    it('throws GitLabApiError on HTTP 409', async () => {
      mockHttpPut.mockRejectedValue(makeAxiosError(409))
      await expect(client.put('/test')).rejects.toMatchObject({
        code: 'GITLAB_API_ERROR',
        statusCode: 409,
      })
    })
  })

  describe('delete() via wrapError', () => {
    let client: GitLabClient

    beforeEach(() => {
      client = new GitLabClient()
    })

    it('returns data on success', async () => {
      mockHttpDelete.mockResolvedValue({ data: null })
      expect(await client.delete('/test')).toBeNull()
    })

    it('throws GitLabApiError on HTTP 404', async () => {
      mockHttpDelete.mockRejectedValue(makeAxiosError(404))
      await expect(client.delete('/test')).rejects.toMatchObject({
        code: 'GITLAB_NOT_FOUND',
        statusCode: 404,
      })
    })
  })
})

describe('retryCondition()', () => {
  let retryCondition: (err: AxiosError) => boolean

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITLAB_API_TOKEN = 'test-token'
    process.env.GITLAB_API_URL = 'http://localhost/api/v4'
    new GitLabClient()
    retryCondition = (mockAxiosRetry.mock.calls[0][1] as { retryCondition: (err: AxiosError) => boolean }).retryCondition
  })

  it('retries on 429', () => {
    expect(retryCondition(makeAxiosError(429))).toBe(true)
  })

  it('retries on 500', () => {
    expect(retryCondition(makeAxiosError(500))).toBe(true)
  })

  it('does not retry on 404', () => {
    expect(retryCondition(makeAxiosError(404))).toBe(false)
  })

  it('does not retry when no response', () => {
    expect(retryCondition(makeAxiosError())).toBe(false)
  })
})

describe('getRetryDelay()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExponentialDelay.mockReturnValue(1000)
  })

  it('returns header value in ms when retry-after is a valid number', () => {
    const err = makeAxiosError(429, {}, { 'retry-after': '60' })
    const result = getRetryDelay(1, err)
    expect(result).toBe(60_000)
    expect(mockExponentialDelay).not.toHaveBeenCalled()
  })

  it('falls back to exponentialDelay when retry-after is not a number', () => {
    const err = makeAxiosError(429, {}, { 'retry-after': 'abc' })
    getRetryDelay(2, err)
    expect(mockExponentialDelay).toHaveBeenCalledWith(2)
  })

  it('falls back to exponentialDelay when retry-after header is absent', () => {
    const err = makeAxiosError(429)
    getRetryDelay(3, err)
    expect(mockExponentialDelay).toHaveBeenCalledWith(3)
  })
})
