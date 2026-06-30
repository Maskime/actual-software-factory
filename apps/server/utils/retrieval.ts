import { embedText } from './embedding'
import { query } from './db'
import { toVectorLiteral } from './indexer/shared'

export interface RetrievedChunk {
  sourceType: string
  sourcePath: string
  content: string
}

interface EmbeddingRow {
  source_type: string
  source_path: string
  content: string
}

/**
 * Semantic search over the `embeddings` table. Embeds the query text with Voyage,
 * then returns the `limit` nearest chunks (cosine distance) scoped to `projectId`.
 * The `project_id = $1` filter guarantees isolation between projects.
 */
export async function retrieveContext(
  projectId: number,
  queryText: string,
  limit = 8,
): Promise<RetrievedChunk[]> {
  if (queryText.trim().length === 0) return []

  const [vector] = await embedText([queryText])
  if (vector === undefined) return []

  const result = await query<EmbeddingRow>(
    `SELECT source_type, source_path, content
    FROM embeddings
    WHERE project_id = $1
    ORDER BY embedding <=> $2::vector
    LIMIT $3`,
    [projectId, toVectorLiteral(vector), limit],
  )

  return result.rows.map(row => ({
    sourceType: row.source_type,
    sourcePath: row.source_path,
    content: row.content,
  }))
}

/**
 * Formats retrieved chunks into a single system-prompt text block. Returns `null`
 * when there is nothing to inject.
 */
export function formatContextBlock(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null

  const parts: string[] = ['[Contexte projet — extraits pertinents]']
  for (const chunk of chunks) {
    parts.push(`--- (${chunk.sourceType}: ${chunk.sourcePath}) ---`, chunk.content)
  }
  return parts.join('\n\n')
}
