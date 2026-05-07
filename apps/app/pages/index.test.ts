import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h } from 'vue'
import IndexPage from './index.vue'

vi.hoisted(() => {
  vi.stubGlobal('definePageMeta', vi.fn())
})

const mockSignOut = vi.fn()
vi.stubGlobal('useAuth', () => ({ signOut: mockSignOut }))

function stubFetch(data: unknown, status: string, error: unknown = null) {
  vi.stubGlobal('useFetch', vi.fn().mockResolvedValue({
    data: ref(data),
    status: ref(status),
    error: ref(error),
  }))
}

function mountPage() {
  return mount(defineComponent({
    render: () => h(Suspense, null, { default: () => h(IndexPage) }),
  }))
}

describe('IndexPage — loading state', () => {
  it('shows spinner while pending', async () => {
    stubFetch(null, 'pending')
    const w = mountPage()
    await flushPromises()
    expect(w.find('.spinner').exists()).toBe(true)
  })
})

describe('IndexPage — no projects', () => {
  it('shows "Aucun projet accessible" when result is empty', async () => {
    stubFetch([], 'success')
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Aucun projet accessible')
  })

  it('does not show spinner when loaded', async () => {
    stubFetch([], 'success')
    const w = mountPage()
    await flushPromises()
    expect(w.find('.spinner').exists()).toBe(false)
  })
})

describe('IndexPage — error state', () => {
  it('shows error state when fetch fails', async () => {
    stubFetch(null, 'error', new Error('Network error'))
    const w = mountPage()
    await flushPromises()
    expect(w.find('.err-state').exists()).toBe(true)
    expect(w.text()).toContain('Impossible de récupérer')
  })
})

describe('IndexPage — sign-out', () => {
  beforeEach(() => mockSignOut.mockReset())

  it('calls signOut with /login callbackUrl on click', async () => {
    stubFetch([], 'success')
    const w = mountPage()
    await flushPromises()
    await w.find('button').trigger('click')
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })
})
