import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h, computed } from 'vue'
import ProjectDashboard from './chat.vue'

vi.stubGlobal('useRoute', () => ({ params: { id: '3' } }))
vi.stubGlobal('useAuth', () => ({ signOut: vi.fn() }))
vi.stubGlobal('computed', computed)

const projects = [{ id: 3, name: 'Software Factory', description: 'Main project', web_url: '' }]

function stubProjects() {
  vi.stubGlobal('useFetch', vi.fn().mockResolvedValue({
    data: ref(projects),
    status: ref('success'),
    error: ref(null),
  }))
}

stubProjects()

function mockFetchOk(lines: string[]) {
  const encoder = new TextEncoder()
  const data = lines.join('\n') + '\n'
  let done = false
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (!done) {
        done = true
        return Promise.resolve({ done: false, value: encoder.encode(data) })
      }
      return Promise.resolve({ done: true, value: undefined as unknown as Uint8Array })
    }),
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: { getReader: () => reader },
  }))
  return reader
}

function mountPage() {
  return mount(defineComponent({
    render: () => h(Suspense, null, { default: () => h(ProjectDashboard) }),
  }), {
    global: {
      stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } },
    },
  })
}

async function sendMessage(w: ReturnType<typeof mountPage>, text = 'mon besoin') {
  await w.find('textarea').setValue(text)
  await w.find('button[aria-label="Envoyer"]').trigger('click')
  await flushPromises()
}

describe('ProjectDashboard — header', () => {
  it('shows project name in header', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.find('.brand-name').text()).toBe('Software Factory')
  })

  it('falls back to default name when project not found', async () => {
    vi.stubGlobal('useRoute', () => ({ params: { id: '999' } }))
    const w = mountPage()
    await flushPromises()
    expect(w.find('.brand-name').text()).toBe('Actual Software Factory')
    vi.stubGlobal('useRoute', () => ({ params: { id: '3' } }))
  })

  it('shows a link to the dashboard', async () => {
    const w = mountPage()
    await flushPromises()
    const dashboardLink = w.find('.hdr-link')
    expect(dashboardLink.exists()).toBe(true)
    expect(dashboardLink.attributes('href')).toBe('/projects/3/dashboard')
  })
})

describe('ProjectDashboard — empty state', () => {
  it('shows placeholder before any message', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Décrivez votre besoin')
  })
})

describe('ProjectDashboard — sendMessage()', () => {
  beforeEach(() => {
    stubProjects()
  })

  it('replaces placeholder with thread after first send', async () => {
    mockFetchOk(['data: hello ', 'data: [DONE]'])
    const w = mountPage()
    await flushPromises()

    await sendMessage(w)

    expect(w.text()).not.toContain('Décrivez votre besoin')
  })

  it('appends streamed words to assistant message', async () => {
    mockFetchOk(['data: bonjour ', 'data: monde ', 'data: [DONE]'])
    const w = mountPage()
    await flushPromises()

    await sendMessage(w, 'test')

    expect(w.text()).toContain('bonjour')
    expect(w.text()).toContain('monde')
  })

  it('stops streaming on [DONE] mid-chunk', async () => {
    mockFetchOk(['data: avant ', 'data: [DONE]', 'data: apres '])
    const w = mountPage()
    await flushPromises()

    await sendMessage(w, 'test')

    expect(w.text()).toContain('avant')
    expect(w.text()).not.toContain('apres')
  })

  it('shows error banner on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const w = mountPage()
    await flushPromises()

    await sendMessage(w)

    expect(w.find('.err-bar').exists()).toBe(true)
    expect(w.text()).toContain('503')
  })

  it('shows error banner on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const w = mountPage()
    await flushPromises()

    await sendMessage(w)

    expect(w.find('.err-bar').exists()).toBe(true)
    expect(w.text()).toContain('Network error')
  })

  it('removes empty assistant message on early error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))
    const w = mountPage()
    await flushPromises()

    await sendMessage(w, 'test')

    expect(w.text()).toContain('test')
    expect(w.find('.err-bar').exists()).toBe(true)
  })
})
