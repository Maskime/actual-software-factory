import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h } from 'vue'
import ProjectsIndex from './index.vue'

const mockSignOut = vi.fn()
vi.stubGlobal('useAuth', () => ({ signOut: mockSignOut }))
vi.stubGlobal('NuxtLink', { template: '<a :href="to"><slot /></a>', props: ['to'] })

function stubFetch(data: unknown, status: string, error: unknown = null) {
  vi.stubGlobal('useFetch', vi.fn().mockResolvedValue({
    data: ref(data),
    status: ref(status),
    error: ref(error),
  }))
}

function mountPage() {
  return mount(defineComponent({
    render: () => h(Suspense, null, { default: () => h(ProjectsIndex) }),
  }), { global: { stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } } })
}

describe('ProjectsIndex — loading', () => {
  it('shows spinner while pending', async () => {
    stubFetch(null, 'pending')
    const w = mountPage()
    await flushPromises()
    expect(w.find('.spinner').exists()).toBe(true)
  })
})

describe('ProjectsIndex — project list', () => {
  const projects = [
    { id: 3, name: 'Software Factory', description: 'Main project', web_url: 'http://gitlab.test/sf' },
    { id: 5, name: 'Other Project', description: null, web_url: 'http://gitlab.test/other' },
  ]

  beforeEach(() => stubFetch(projects, 'success'))

  it('renders a card for each project', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('.project-card')).toHaveLength(2)
  })

  it('shows project names', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Software Factory')
    expect(w.text()).toContain('Other Project')
  })

  it('shows project description when present', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Main project')
  })

  it('does not render .project-desc when description is null', async () => {
    const w = mountPage()
    await flushPromises()
    const cards = w.findAll('.project-card')
    expect(cards[1]?.find('.project-desc').exists()).toBe(false)
  })

  it('links each card to /projects/[id]', async () => {
    const w = mountPage()
    await flushPromises()
    const links = w.findAll('.project-card')
    expect(links[0]?.attributes('href')).toBe('/projects/3')
    expect(links[1]?.attributes('href')).toBe('/projects/5')
  })

  it('does not show spinner when loaded', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.find('.spinner').exists()).toBe(false)
  })
})

describe('ProjectsIndex — error state', () => {
  it('shows error state on fetch failure', async () => {
    stubFetch(null, 'error', new Error('Network error'))
    const w = mountPage()
    await flushPromises()
    expect(w.find('.err-state').exists()).toBe(true)
    expect(w.text()).toContain('Impossible de récupérer')
  })
})

describe('ProjectsIndex — sign-out', () => {
  beforeEach(() => {
    mockSignOut.mockReset()
    stubFetch([], 'success')
  })

  it('calls signOut with /login callbackUrl on click', async () => {
    const w = mountPage()
    await flushPromises()
    await w.find('button').trigger('click')
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })
})
