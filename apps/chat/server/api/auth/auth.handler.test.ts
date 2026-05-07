import { describe, it, expect, vi } from 'vitest'

// #auth is aliased to the local mock in vitest.config.ts — no vi.mock needed.
vi.mock('next-auth/providers/gitlab', () => {
  const factory = vi.fn((opts: unknown) => opts)
  return { default: { default: factory } }
})

import handler from './[...]'

const config = handler as any
const providerOpts = config.providers[0] as any

describe('auth handler config', () => {
  it('uses /login as sign-in page', () => {
    expect(config.pages.signIn).toBe('/login')
  })

  it('sets authorization URL with public GitLab URL', () => {
    expect(providerOpts.authorization.url).toBe('http://localhost/oauth/authorize')
  })

  it('sets token URL with internal GitLab URL', () => {
    expect(providerOpts.token).toBe('http://localhost/oauth/token')
  })

  it('sets authorization scope to read_user read_api', () => {
    expect(providerOpts.authorization.params.scope).toBe('read_user read_api')
  })

  describe('profile()', () => {
    it('maps GitLab profile fields to user', () => {
      const profile = {
        id: 42,
        name: 'Alice',
        email: 'alice@example.com',
        avatar_url: 'http://example.com/avatar.png',
      }
      const user = providerOpts.profile(profile)
      expect(user.id).toBe('42')
      expect(user.name).toBe('Alice')
      expect(user.email).toBe('alice@example.com')
      expect(user.image).toBe('http://example.com/avatar.png')
    })

    it('returns null for missing email and avatar_url', () => {
      const profile = { id: 7, name: 'Bob' }
      const user = providerOpts.profile(profile)
      expect(user.email).toBeNull()
      expect(user.image).toBeNull()
    })

    it('coerces numeric id to string', () => {
      const user = providerOpts.profile({ id: 99, name: 'Test' })
      expect(typeof user.id).toBe('string')
      expect(user.id).toBe('99')
    })
  })

  describe('userinfo.request()', () => {
    it('fetches user data with Bearer token and returns JSON', async () => {
      const fakeUser = { id: 1, name: 'Test User' }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve(fakeUser),
      }))

      const result = await providerOpts.userinfo.request({
        provider: { userinfo: { url: 'http://gitlab.test/api/v4/user' } },
        tokens: { access_token: 'tok-abc123' },
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://gitlab.test/api/v4/user',
        { headers: { Authorization: 'Bearer tok-abc123' } },
      )
      expect(result).toEqual(fakeUser)
      vi.unstubAllGlobals()
    })
  })
})
