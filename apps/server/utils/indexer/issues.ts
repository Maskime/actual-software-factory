import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createConsola } from 'consola'
import { embedText } from '../embedding'
import { query, withClient } from '../db'
import { parseToolResult, connectGitlab, hashContent, toVectorLiteral } from './shared'

const logger = createConsola({ level: 4 }).withTag('indexer:issues')

const SOURCE_TYPE = 'issue'

// ~400 tokens × 4 chars/token
const MAX_CHUNK_CHARS = 1600

interface GitlabIssue {
  iid: number
  title: string
  description: string | null
  labels: string[]
  state: 'opened' | 'closed'
}

export interface IssueIndexOptions {
  projectId: number
  mcpGitlabUrl?: string
}

export interface IssueIndexResult {
  issuesIndexed: number
  issuesSkipped: number
  chunksUpserted: number
}

/** Returns the canonical source_path for an issue (used as key and display reference). */
export function issueSourcePath(iid: number, title: string): string {
  return `#${iid} ${title}`
}

/** Builds the text chunk for one issue (title + labels + description), truncated to MAX_CHUNK_CHARS. */
export function buildIssueChunk(issue: { iid: number; title: string; description: string | null; labels: string[] }): string {
  const parts: string[] = [`#${issue.iid} ${issue.title}`]
  if (issue.labels.length > 0) {
    parts.push(`Labels: ${issue.labels.join(', ')}`)
  }
  if (issue.description?.trim()) {
    parts.push(issue.description.trim())
  }
  const full = parts.join('\n')
  return full.length > MAX_CHUNK_CHARS ? full.slice(0, MAX_CHUNK_CHARS) : full
}

async function listOpenIssues(client: Client, projectId: string): Promise<GitlabIssue[]> {
  const issues: GitlabIssue[] = []
  let page = 1
  while (true) {
    const result = await client.callTool({
      name: 'gitlab_list_issues',
      arguments: { project_id: projectId, state: 'opened', page },
    })
    const batch = parseToolResult<GitlabIssue[]>(result) ?? []
    if (batch.length === 0) break
    issues.push(...batch)
    page++
  }
  return issues
}

/**
 * Fetch all open GitLab issues (including EPIC-labelled ones), embed one chunk per
 * issue and upsert into the `embeddings` table. Closed issues that were previously
 * indexed are deleted at the end (orphan cleanup). The operation is idempotent.
 */
export async function indexProjectIssues(opts: IssueIndexOptions): Promise<IssueIndexResult> {
  const projectId = String(opts.projectId)
  const mcpUrl = opts.mcpGitlabUrl || process.env.NUXT_MCP_GITLAB_URL || 'http://localhost:3001'

  const client = await connectGitlab(mcpUrl)
  let issuesIndexed = 0
  let issuesSkipped = 0
  let chunksUpserted = 0

  try {
    const issues = await listOpenIssues(client, projectId)
    const total = issues.length
    logger.info(`[indexer:issues] ${total} issue(s) ouvertes sur project ${projectId}`)

    const seenPaths: string[] = []

    for (const [i, issue] of issues.entries()) {
      const sourcePath = issueSourcePath(issue.iid, issue.title)
      logger.info(`[indexer:issues] (${i + 1}/${total}) ${sourcePath}`)

      const content = buildIssueChunk(issue)
      if (content.trim().length === 0) continue

      const hash = hashContent(content)

      const existing = await query<{ content_hash: string | null }>(
        'SELECT content_hash FROM embeddings WHERE project_id = $1 AND source_type = $2 AND source_path = $3 LIMIT 1',
        [opts.projectId, SOURCE_TYPE, sourcePath]
      )
      if (existing.rows.length > 0 && existing.rows[0]?.content_hash === hash) {
        issuesSkipped++
        seenPaths.push(sourcePath)
        continue
      }

      const vectors = await embedText([content])
      const vector = vectors[0]
      if (vector === undefined) continue

      await withClient(async (db) => {
        await db.query(
          'DELETE FROM embeddings WHERE project_id = $1 AND source_type = $2 AND source_path = $3',
          [opts.projectId, SOURCE_TYPE, sourcePath]
        )
        await db.query(
          'INSERT INTO embeddings (project_id, source_type, source_path, content, content_hash, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector)',
          [opts.projectId, SOURCE_TYPE, sourcePath, content, hash, toVectorLiteral(vector)]
        )
      })

      issuesIndexed++
      chunksUpserted++
      seenPaths.push(sourcePath)
    }

    const orphans = await query(
      'DELETE FROM embeddings WHERE project_id = $1 AND source_type = $2 AND source_path <> ALL($3::text[])',
      [opts.projectId, SOURCE_TYPE, seenPaths]
    )
    if (orphans.rowCount) {
      logger.info(`[indexer:issues] ${orphans.rowCount} chunk(s) orphelin(s) supprimé(s)`)
    }
  } finally {
    await client.close()
  }

  logger.info(
    `[indexer:issues] terminé : ${issuesIndexed} indexée(s), ${issuesSkipped} inchangée(s), ${chunksUpserted} chunk(s)`
  )
  return { issuesIndexed, issuesSkipped, chunksUpserted }
}
