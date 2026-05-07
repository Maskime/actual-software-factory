import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  readBody: vi.fn(),
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

vi.mock('#auth', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

import * as h3 from 'h3'
import { getToken } from '#auth'
import handler from './submit.post'

const mockEvent = { context: { params: { id: '3' } } }
const defaultConfig = { gitlabInternalUrl: '', gitlabUrl: 'http://gitlab.test' }
const validBody = { title: 'Mon besoin', description: '## Reformulation du besoin\n...' }

describe('POST /api/projects/[id]/submit', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue(defaultConfig))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws 401 when getToken returns null', async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when token has no accessToken', async () => {
    vi.mocked(getToken).mockResolvedValue({ sub: 'user' } as never)
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 400 when title is missing', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(h3.readBody).mockResolvedValue({ description: 'desc' } as never)
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when description is missing', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(h3.readBody).mockResolvedValue({ title: 'title' } as never)
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when projectId is not numeric', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(h3.readBody).mockResolvedValue(validBody as never)
    const badEvent = { context: { params: { id: '../admin' } } }
    await expect((handler as Function)(badEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns { url, iid } on successful issue creation', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok-123' } as never)
    vi.mocked(h3.readBody).mockResolvedValue(validBody as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web_url: 'http://gitlab.test/root/sf/-/issues/42', iid: 42 }),
    }))

    const result = await (handler as Function)(mockEvent)

    expect(result).toEqual({ url: 'http://gitlab.test/root/sf/-/issues/42', iid: 42 })
  })

  it('throws 502 when GitLab responds with non-200', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(h3.readBody).mockResolvedValue(validBody as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }))
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('uses gitlabInternalUrl when set, falling back to gitlabUrl', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(h3.readBody).mockResolvedValue(validBody as never)
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({
      gitlabInternalUrl: 'http://internal-gitlab',
      gitlabUrl: 'http://public-gitlab',
    }))
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web_url: 'http://internal-gitlab/issues/1', iid: 1 }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await (handler as Function)(mockEvent)

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://internal-gitlab/api/v4/projects/3/issues',
      expect.any(Object),
    )
  })

  it('passes Bearer token in Authorization header', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'my-token' } as never)
    vi.mocked(h3.readBody).mockResolvedValue(validBody as never)
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web_url: 'http://gitlab.test/issues/1', iid: 1 }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await (handler as Function)(mockEvent)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      }),
    )
  })

  it('truncates title to 255 characters', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok' } as never)
    const longTitle = 'a'.repeat(300)
    vi.mocked(h3.readBody).mockResolvedValue({ title: longTitle, description: 'desc' } as never)
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web_url: 'http://gitlab.test/issues/1', iid: 1 }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await (handler as Function)(mockEvent)

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(sentBody.title.length).toBe(255)
  })
})
