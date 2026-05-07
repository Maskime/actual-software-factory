import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
})

const mockNavigateTo = vi.fn()
vi.stubGlobal('navigateTo', mockNavigateTo)

const mockFetch = vi.fn()
vi.stubGlobal('useRequestFetch', () => mockFetch)

import middleware from './home-redirect'

describe('home-redirect middleware', () => {
  beforeEach(() => {
    mockNavigateTo.mockReset()
    mockFetch.mockReset()
  })

  it('redirects to /projects/[id] when exactly 1 project is returned', async () => {
    mockFetch.mockResolvedValue([{ id: 3, name: 'SF', description: null, web_url: '' }])
    await (middleware as Function)()
    expect(mockNavigateTo).toHaveBeenCalledWith('/projects/3', { replace: true })
  })

  it('redirects to /projects when multiple projects are returned', async () => {
    mockFetch.mockResolvedValue([
      { id: 1, name: 'A', description: null, web_url: '' },
      { id: 2, name: 'B', description: null, web_url: '' },
    ])
    await (middleware as Function)()
    expect(mockNavigateTo).toHaveBeenCalledWith('/projects', { replace: true })
  })

  it('does nothing when 0 projects are returned', async () => {
    mockFetch.mockResolvedValue([])
    await (middleware as Function)()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('does nothing when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    await (middleware as Function)()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})
