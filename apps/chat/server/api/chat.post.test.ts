import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  readBody: vi.fn(),
  setResponseHeader: vi.fn(),
  sendStream: vi.fn().mockResolvedValue(undefined),
}))

import handler from './chat.post'
import * as h3 from 'h3'

const mockEvent = {}

describe('chat.post handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets SSE response headers', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ message: 'hello' })

    const promise = (handler as Function)(mockEvent)
    await vi.runAllTimersAsync()
    await promise

    expect(h3.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Content-Type', 'text/event-stream; charset=utf-8')
    expect(h3.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
    expect(h3.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Connection', 'keep-alive')
  })

  it('calls sendStream with a ReadableStream', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ message: 'hello world' })

    const promise = (handler as Function)(mockEvent)
    await vi.runAllTimersAsync()
    await promise

    expect(h3.sendStream).toHaveBeenCalledWith(mockEvent, expect.any(ReadableStream))
  })

  it('streams one chunk per word plus [DONE]', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ message: 'a b' })

    const chunks: string[] = []
    vi.mocked(h3.sendStream).mockImplementation((_event, stream: ReadableStream) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      async function drain() {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(decoder.decode(value))
        }
      }
      return drain() as unknown as ReturnType<typeof h3.sendStream>
    })

    const promise = (handler as Function)(mockEvent)
    await vi.runAllTimersAsync()
    await promise

    // "[Stub] Vous avez écrit : a b" → 5 word chunks + [DONE]
    const done = chunks.find(c => c.includes('[DONE]'))
    expect(done).toBeDefined()
    expect(chunks.length).toBeGreaterThan(1)
  })
})
