import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  readBody: vi.fn(),
  setResponseHeader: vi.fn(),
  sendStream: vi.fn().mockResolvedValue(undefined),
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

vi.mock('@anthropic-ai/sdk', () => {
  const makeStream = (texts: string[], throwAfter?: Error) => {
    async function* gen() {
      for (const text of texts) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
      }
      if (throwAfter) throw throwAfter
    }
    return { [Symbol.asyncIterator]: gen }
  }

  const APIError = class extends Error {
    constructor(message: string) { super(message) }
  }

  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: {
      stream: vi.fn().mockReturnValue(makeStream(['Hello', ' world'])),
    },
  }))
  ;(Anthropic as any).APIError = APIError

  return { default: Anthropic }
})

import handler from './chat.post'
import * as h3 from 'h3'
import Anthropic from '@anthropic-ai/sdk'

const mockConfig = {
  anthropicApiKey: 'test-api-key',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicSystemPrompt: 'Test system prompt',
}

const mockEvent = {}

describe('chat.post handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue(mockConfig))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets SSE response headers', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] })

    const chunks: string[] = []
    vi.mocked(h3.sendStream).mockImplementation((_ev, stream: ReadableStream) => {
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

    await (handler as Function)(mockEvent)

    expect(h3.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Content-Type', 'text/event-stream; charset=utf-8')
    expect(h3.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
    expect(h3.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Connection', 'keep-alive')
  })

  it('streams JSON-encoded deltas then [DONE]', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] })

    const chunks: string[] = []
    vi.mocked(h3.sendStream).mockImplementation((_ev, stream: ReadableStream) => {
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

    await (handler as Function)(mockEvent)

    expect(chunks).toContainEqual('data: "Hello"\n\n')
    expect(chunks).toContainEqual('data: " world"\n\n')
    expect(chunks).toContainEqual('data: [DONE]\n\n')
  })

  it('throws 400 when messages array is absent (before any SSE header)', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({})

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(h3.setResponseHeader).not.toHaveBeenCalled()
  })

  it('throws 400 when messages array is empty (before any SSE header)', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [] })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(h3.setResponseHeader).not.toHaveBeenCalled()
  })

  it('throws 500 when API key is missing (before any SSE header)', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] })
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({ ...mockConfig, anthropicApiKey: '' }))

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 500 })
    expect(h3.setResponseHeader).not.toHaveBeenCalled()
  })

  it('sends [ERROR] SSE chunk when Anthropic API throws mid-stream', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] })

    const apiError = new (Anthropic as any).APIError('rate limit exceeded')
    const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>
    MockAnthropic.mockImplementation(() => ({
      messages: {
        stream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            throw apiError
          },
        }),
      },
    }))

    const chunks: string[] = []
    vi.mocked(h3.sendStream).mockImplementation((_ev, stream: ReadableStream) => {
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

    await (handler as Function)(mockEvent)

    const errorChunk = chunks.find(c => c.includes('[ERROR]'))
    expect(errorChunk).toBeDefined()
    expect(errorChunk).toContain('rate limit exceeded')
  })
})
