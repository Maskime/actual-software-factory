import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.hoisted(() => {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
})

const mockNavigateTo = vi.fn()
vi.stubGlobal('navigateTo', mockNavigateTo)

import middleware from './auth.global'

describe('auth.global middleware', () => {
  beforeEach(() => {
    mockNavigateTo.mockReset()
  })

  function withStatus(value: string) {
    vi.stubGlobal('useAuth', () => ({ status: ref(value) }))
  }

  it('does nothing while loading', () => {
    withStatus('loading')
    const result = (middleware as Function)({ path: '/dashboard' })
    expect(result).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('redirects to /login when unauthenticated on a protected route', () => {
    withStatus('unauthenticated')
    ;(middleware as Function)({ path: '/dashboard' })
    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
  })

  it('does nothing when unauthenticated on /login itself', () => {
    withStatus('unauthenticated')
    const result = (middleware as Function)({ path: '/login' })
    expect(result).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('does nothing when authenticated', () => {
    withStatus('authenticated')
    const result = (middleware as Function)({ path: '/dashboard' })
    expect(result).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})
