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

vi.mock('#auth', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

import handler from './chat.post'
import * as h3 from 'h3'
import Anthropic from '@anthropic-ai/sdk'
import * as auth from '#auth'
import { QUALIFICATION_PROMPT } from '../prompts/qualification'

describe('QUALIFICATION_PROMPT content', () => {
  it('covers the 4 required dimensions', () => {
    const lower = QUALIFICATION_PROMPT.toLowerCase()
    expect(lower).toContain('contexte')
    expect(lower).toContain('objectif')
    expect(lower).toContain('contraintes')
    expect(lower).toContain('done')
  })

  it('encodes the 3-question limit rule', () => {
    expect(QUALIFICATION_PROMPT).toContain('3')
  })
})

const mockConfig = {
  anthropicApiKey: 'test-api-key',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicSystemPrompt: 'Test system prompt',
  gitlabUrl: 'http://gitlab.test',
  gitlabInternalUrl: '',
}

const mockEvent = {}

function drainStream(stream: ReadableStream): Promise<string[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  async function drain() {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value))
    }
  }
  return drain().then(() => chunks)
}

describe('chat.post handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue(mockConfig))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets SSE response headers', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] })

    const chunks: string[] = []
    vi.mocked(h3.sendStream).mockImplementation((_ev, stream: ReadableStream) => {
      return drainStream(stream).then(c => { chunks.push(...c) }) as unknown as ReturnType<typeof h3.sendStream>
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
      return drainStream(stream).then(c => { chunks.push(...c) }) as unknown as ReturnType<typeof h3.sendStream>
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

  it('uses QUALIFICATION_PROMPT when anthropicSystemPrompt is empty', async () => {
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] })
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue({ ...mockConfig, anthropicSystemPrompt: '' }))

    const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>
    const streamSpy = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
      },
    })
    MockAnthropic.mockImplementation(() => ({ messages: { stream: streamSpy } }))

    vi.mocked(h3.sendStream).mockResolvedValue(undefined)

    await (handler as Function)(mockEvent)

    expect(streamSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.arrayContaining([
          expect.objectContaining({ text: QUALIFICATION_PROMPT }),
        ]),
      }),
    )
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
      return drainStream(stream).then(c => { chunks.push(...c) }) as unknown as ReturnType<typeof h3.sendStream>
    })

    await (handler as Function)(mockEvent)

    const errorChunk = chunks.find(c => c.includes('[ERROR]'))
    expect(errorChunk).toBeDefined()
    expect(errorChunk).toContain('rate limit exceeded')
  })
})

describe('chat.post — project context injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue(mockConfig))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('injects README.md content as a second system block when projectId is provided', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'token-xyz' } as any)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('README.md')) return Promise.resolve({ ok: true, text: () => Promise.resolve('# My Project') })
      return Promise.resolve({ ok: false, status: 404 })
    }))
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], projectId: 3 })

    const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>
    const streamSpy = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
      },
    })
    MockAnthropic.mockImplementation(() => ({ messages: { stream: streamSpy } }))
    vi.mocked(h3.sendStream).mockResolvedValue(undefined)

    await (handler as Function)(mockEvent)

    const callArg = streamSpy.mock.calls[0][0]
    expect(callArg.system).toHaveLength(2)
    expect(callArg.system[1].text).toContain('# My Project')
    expect(callArg.system[1].text).toContain('Contexte du projet')
  })

  it('uses only one system block when GitLab returns 404 for all files', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'token-xyz' } as any)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], projectId: 3 })

    const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>
    const streamSpy = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
      },
    })
    MockAnthropic.mockImplementation(() => ({ messages: { stream: streamSpy } }))
    vi.mocked(h3.sendStream).mockResolvedValue(undefined)

    await (handler as Function)(mockEvent)

    const callArg = streamSpy.mock.calls[0][0]
    expect(callArg.system).toHaveLength(1)
  })

  it('uses only one system block when getToken returns null', async () => {
    vi.mocked(auth.getToken).mockResolvedValue(null)
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], projectId: 3 })

    const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>
    const streamSpy = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
      },
    })
    MockAnthropic.mockImplementation(() => ({ messages: { stream: streamSpy } }))
    vi.mocked(h3.sendStream).mockResolvedValue(undefined)

    await (handler as Function)(mockEvent)

    const callArg = streamSpy.mock.calls[0][0]
    expect(callArg.system).toHaveLength(1)
  })

  it('truncates README.md content to 50 000 characters', async () => {
    const longContent = 'x'.repeat(60_000)
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'token-xyz' } as any)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('README.md')) return Promise.resolve({ ok: true, text: () => Promise.resolve(longContent) })
      return Promise.resolve({ ok: false, status: 404 })
    }))
    vi.mocked(h3.readBody).mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], projectId: 3 })

    const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>
    const streamSpy = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
      },
    })
    MockAnthropic.mockImplementation(() => ({ messages: { stream: streamSpy } }))
    vi.mocked(h3.sendStream).mockResolvedValue(undefined)

    await (handler as Function)(mockEvent)

    const callArg = streamSpy.mock.calls[0][0]
    expect(callArg.system).toHaveLength(2)
    // The README content in the block should be at most 50 000 chars
    const readmeContent = callArg.system[1].text as string
    expect(readmeContent).not.toContain('x'.repeat(50_001))
    expect(readmeContent.length).toBeLessThanOrEqual(50_000 + 200) // +200 for context header/labels
  })
})
