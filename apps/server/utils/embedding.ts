import { VoyageAIClient } from 'voyageai'

const EMBED_MODEL = 'voyage-code-3'
const BATCH_SIZE = 100
const CHARS_PER_TOKEN = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function chunkText(text: string, maxTokens = 400, overlap = 50): string[] {
  const sentences = text.split(/(?<=[.!?\n])\s+/)
  const chunks: string[] = []
  let current: string[] = []
  let currentTokens = 0

  for (const sentence of sentences) {
    const st = estimateTokens(sentence)
    if (currentTokens + st > maxTokens && current.length > 0) {
      chunks.push(current.join(' '))
      const overlapSentences: string[] = []
      let overlapTokens = 0
      for (let i = current.length - 1; i >= 0 && overlapTokens < overlap; i--) {
        const item = current[i]
        if (item === undefined) continue
        overlapTokens += estimateTokens(item)
        overlapSentences.unshift(item)
      }
      current = overlapSentences
      currentTokens = overlapTokens
    }
    current.push(sentence)
    currentTokens += st
  }

  if (current.length > 0) chunks.push(current.join(' '))
  return chunks.filter(c => c.trim().length > 0)
}

export async function embedText(chunks: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY environment variable is required')

  const client = new VoyageAIClient({ apiKey })
  const embeddings: number[][] = []

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    const response = await client.embed({ input: batch, model: EMBED_MODEL })
    if (!response.data) throw new Error('No data returned from Voyage AI')
    embeddings.push(...response.data.map(d => {
      if (!d.embedding) throw new Error('Missing embedding in Voyage AI response')
      return d.embedding
    }))
  }

  return embeddings
}
