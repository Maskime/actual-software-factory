import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockEmbed = vi.fn()

vi.mock('voyageai', () => ({
  VoyageAIClient: vi.fn().mockImplementation(() => ({
    embed: mockEmbed,
  })),
}))

import { chunkText, embedText } from './embedding'

function makeVector(dim = 1024): number[] {
  return Array.from({ length: dim }, () => Math.random())
}

function makeMockResponse(count: number, dim = 1024) {
  return {
    data: Array.from({ length: count }, () => ({ embedding: makeVector(dim) })),
  }
}

describe('chunkText', () => {
  it('returns the whole text as one chunk when short enough', () => {
    const text = 'Hello world. This is a test.'
    const chunks = chunkText(text, 400, 50)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(text)
  })

  it('splits a ~2000-token text into chunks each ≤ 400 tokens', () => {
    // ~4 chars per token → 2000 tokens ≈ 8000 chars
    const sentence = 'This is a sentence with about twenty characters. '
    const text = sentence.repeat(200) // ~10 000 chars ≈ 2500 tokens
    const chunks = chunkText(text, 400, 50)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const estimatedTokens = Math.ceil(chunk.length / 4)
      expect(estimatedTokens).toBeLessThanOrEqual(400 + 50) // allow overlap buffer
    }
  })

  it('produces overlap between consecutive chunks', () => {
    const sentence = 'Sentence number X here ends with a period. '
    const text = sentence.repeat(100) // large enough to produce multiple chunks
    const chunks = chunkText(text, 200, 50)

    expect(chunks.length).toBeGreaterThan(1)
    // The end of chunk N and the start of chunk N+1 share some content (overlap)
    const tailOfFirst = chunks[0].slice(-100)
    const headOfSecond = chunks[1].slice(0, 100)
    // At least one sentence from the end of chunk 0 should appear at start of chunk 1
    const tailSentences = tailOfFirst.split(/\.\s+/).filter(s => s.length > 5)
    const headSentences = headOfSecond.split(/\.\s+/).filter(s => s.length > 5)
    const hasOverlap = tailSentences.some(s => headSentences.some(h => h.includes(s.slice(0, 20))))
    expect(hasOverlap).toBe(true)
  })

  it('filters out empty chunks', () => {
    const chunks = chunkText('   \n   ', 400, 50)
    expect(chunks).toHaveLength(0)
  })

  it('handles a single very long sentence without crashing', () => {
    const longSentence = 'word '.repeat(500) // ~2500 tokens, no split points
    const chunks = chunkText(longSentence, 400, 50)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('embedText', () => {
  const originalEnv = process.env.VOYAGE_API_KEY

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = 'test-api-key'
    mockEmbed.mockReset()
  })

  afterEach(() => {
    process.env.VOYAGE_API_KEY = originalEnv
  })

  it('throws when VOYAGE_API_KEY is missing', async () => {
    delete process.env.VOYAGE_API_KEY
    await expect(embedText(['hello'])).rejects.toThrow('VOYAGE_API_KEY environment variable is required')
  })

  it('returns 1024-dim vectors for each chunk', async () => {
    const chunks = ['chunk one', 'chunk two', 'chunk three']
    mockEmbed.mockResolvedValue(makeMockResponse(chunks.length))

    const result = await embedText(chunks)

    expect(result).toHaveLength(chunks.length)
    for (const vec of result) {
      expect(vec).toHaveLength(1024)
    }
  })

  it('sends chunks in batches of 100 for >100 inputs', async () => {
    const chunks = Array.from({ length: 250 }, (_, i) => `chunk ${i}`)
    mockEmbed.mockImplementation((args: { input: string[] }) =>
      Promise.resolve(makeMockResponse(args.input.length))
    )

    const result = await embedText(chunks)

    expect(mockEmbed).toHaveBeenCalledTimes(3) // 100 + 100 + 50
    expect(mockEmbed.mock.calls[0][0].input).toHaveLength(100)
    expect(mockEmbed.mock.calls[1][0].input).toHaveLength(100)
    expect(mockEmbed.mock.calls[2][0].input).toHaveLength(50)
    expect(result).toHaveLength(250)
  })

  it('calls the API with the correct model', async () => {
    mockEmbed.mockResolvedValue(makeMockResponse(1))
    await embedText(['test'])
    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ model: 'voyage-code-3' }))
  })

  it('propagates API errors', async () => {
    mockEmbed.mockRejectedValue(new Error('API rate limit exceeded'))
    await expect(embedText(['hello'])).rejects.toThrow('API rate limit exceeded')
  })
})
