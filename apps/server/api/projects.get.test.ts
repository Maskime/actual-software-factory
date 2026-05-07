import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

// #auth is aliased to server/__mocks__/nuxt-auth.ts in vitest.config.ts
import { getToken } from '#auth'
import handler from './projects.get'

const mockEvent = {}

const defaultConfig = { gitlabInternalUrl: '', gitlabUrl: 'http://gitlab.test' }

describe('GET /api/projects', () => {
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

  it('returns mapped project list on success', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'tok-123' } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { id: 3, name: 'Software Factory', description: 'Main project', web_url: 'http://gitlab.test/root/sf', other: 'ignored' },
      ]),
    }))

    const result = await (handler as Function)(mockEvent)

    expect(result).toEqual([
      { id: 3, name: 'Software Factory', description: 'Main project', web_url: 'http://gitlab.test/root/sf' },
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
      'http://internal-gitlab/api/v4/projects?membership=true',
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
