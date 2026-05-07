import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

import { getToken } from '#auth'
import handler from './issues.get'

const mockEvent = { context: { params: { id: '3' } } }
const defaultConfig = { gitlabInternalUrl: '', gitlabUrl: 'http://gitlab.test' }

describe('GET /api/projects/[id]/issues', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue(defaultConfig))
  })

  it('throws 401 when getToken returns null', async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when token has no accessToken', async () => {
    vi.mocked(getToken).mockResolvedValue({ sub: 'user' } as never)
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns mapped issues on success', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok-123' } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          iid: 1,
          title: 'Fix login bug',
          labels: ['workflow::dev', 'bug'],
          state: 'opened',
          web_url: 'http://gitlab.test/root/sf/-/issues/1',
          other: 'ignored',
        },
      ]),
    }))

    const result = await (handler as Function)(mockEvent)

    expect(result).toEqual([
      {
        iid: 1,
        title: 'Fix login bug',
        labels: ['workflow::dev', 'bug'],
        state: 'opened',
        web_url: 'http://gitlab.test/root/sf/-/issues/1',
      },
    ])
  })

  it('throws 502 when GitLab responds with non-200', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok-123' } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('uses gitlabInternalUrl when set, falling back to gitlabUrl', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok-123' } as never)
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({
      gitlabInternalUrl: 'http://internal-gitlab',
      gitlabUrl: 'http://public-gitlab',
    }))
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    vi.stubGlobal('fetch', fetchSpy)

    await (handler as Function)(mockEvent)

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://internal-gitlab/api/v4/projects/3/issues?per_page=100&state=all',
      expect.any(Object),
    )
  })

  it('passes Bearer token in Authorization header', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'my-token' } as never)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    vi.stubGlobal('fetch', fetchSpy)

    await (handler as Function)(mockEvent)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      { headers: { Authorization: 'Bearer my-token' } },
    )
  })
})
