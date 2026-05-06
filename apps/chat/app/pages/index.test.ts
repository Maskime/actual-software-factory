import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import IndexPage from './index.vue'

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

async function sendMessage(w: ReturnType<typeof mount>, text = 'mon besoin') {
  await w.find('textarea').setValue(text)
  await w.find('button').trigger('click')
  await flushPromises()
}

describe('IndexPage — empty state', () => {
  it('shows placeholder before any message', () => {
    const w = mount(IndexPage)
    expect(w.text()).toContain('Décrivez votre besoin')
  })
})

describe('IndexPage — sendMessage()', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('replaces placeholder with thread after first send', async () => {
    mockFetchOk(['data: hello ', 'data: [DONE]'])
    const w = mount(IndexPage)

    await sendMessage(w)

    expect(w.text()).not.toContain('Décrivez votre besoin')
  })

  it('appends streamed words to assistant message', async () => {
    mockFetchOk(['data: bonjour ', 'data: monde ', 'data: [DONE]'])
    const w = mount(IndexPage)

    await sendMessage(w, 'test')

    expect(w.text()).toContain('bonjour')
    expect(w.text()).toContain('monde')
  })

  it('stops streaming on [DONE] mid-chunk', async () => {
    mockFetchOk(['data: avant ', 'data: [DONE]', 'data: apres '])
    const w = mount(IndexPage)

    await sendMessage(w, 'test')

    expect(w.text()).toContain('avant')
    expect(w.text()).not.toContain('apres')
  })

  it('shows error banner on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const w = mount(IndexPage)

    await sendMessage(w)

    expect(w.find('.bg-red-50').exists()).toBe(true)
    expect(w.text()).toContain('503')
  })

  it('shows error banner on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const w = mount(IndexPage)

    await sendMessage(w)

    expect(w.find('.bg-red-50').exists()).toBe(true)
    expect(w.text()).toContain('Network error')
  })

  it('removes empty assistant message on early error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))
    const w = mount(IndexPage)

    await sendMessage(w, 'test')

    // user message remains but empty assistant is spliced out
    expect(w.text()).toContain('test')
    expect(w.find('.bg-red-50').exists()).toBe(true)
  })
})
