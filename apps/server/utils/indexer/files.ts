import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createConsola } from 'consola'
import { chunkText, embedText } from '../embedding'
import { query, withClient } from '../db'

const logger = createConsola({ level: 4 }).withTag('indexer')

export const INDEXABLE_EXTENSIONS = ['.ts', '.vue', '.md', '.json']
export const EXCLUDED_PATH_SEGMENTS = ['node_modules/', 'dist/', '.nuxt/']
export const SOURCE_TYPE = 'code'

interface TreeEntry {
  id: string
  name: string
  type: 'blob' | 'tree'
  path: string
  mode: string
}

interface GitlabFile {
  file_name: string
  file_path: string
  size: number
  content: string
  ref: string
}

export interface IndexOptions {
  projectId: number
  ref?: string
  mcpGitlabUrl?: string
}

export interface IndexResult {
  filesIndexed: number
  filesSkipped: number
  chunksUpserted: number
}

/** True when the path is under one of the excluded directories. */
export function isExcludedDir(path: string): boolean {
  const normalized = path.endsWith('/') ? path : `${path}/`
  return EXCLUDED_PATH_SEGMENTS.some(seg => normalized.includes(seg))
}

/** True when the file should be indexed (right extension, not excluded). */
export function isIndexable(path: string): boolean {
  if (isExcludedDir(path)) return false
  return INDEXABLE_EXTENSIONS.some(ext => path.endsWith(ext))
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function parseToolResult<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>
  if (result.isError) {
    throw new Error(content[0]?.text ?? 'Erreur MCP inconnue')
  }
  return JSON.parse(content[0]?.text ?? 'null') as T
}

function connectGitlab(mcpUrl: string): Promise<Client> {
  const client = new Client({ name: 'portal-indexer', version: '1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`))
  return client.connect(transport).then(() => client)
}

async function resolveRef(client: Client, projectId: string): Promise<string> {
  const project = await client.callTool({
    name: 'gitlab_get_project',
    arguments: { project_id: projectId },
  })
  const parsed = parseToolResult<{ default_branch?: string }>(project)
  return parsed?.default_branch || 'main'
}

/**
 * Walk the repository tree directory by directory (not recursive:true, which the
 * MCP tool caps at 100 entries), pruning excluded directories. Returns the list
 * of indexable blob paths.
 */
async function listSourceFiles(client: Client, projectId: string, ref: string): Promise<string[]> {
  const files: string[] = []

  async function walk(path?: string): Promise<void> {
    const args: Record<string, unknown> = { project_id: projectId, ref }
    if (path !== undefined) args.path = path
    const treeResult = await client.callTool({ name: 'gitlab_get_repository_tree', arguments: args })
    const entries = parseToolResult<TreeEntry[]>(treeResult) ?? []

    for (const entry of entries) {
      if (entry.type === 'tree') {
        if (!isExcludedDir(entry.path)) await walk(entry.path)
      } else if (entry.type === 'blob' && isIndexable(entry.path)) {
        files.push(entry.path)
      }
    }
  }

  await walk()
  return files
}

async function readFileContent(
  client: Client,
  projectId: string,
  path: string,
  ref: string
): Promise<string> {
  const fileResult = await client.callTool({
    name: 'gitlab_get_file',
    arguments: { project_id: projectId, file_path: path, ref },
  })
  const parsed = parseToolResult<GitlabFile>(fileResult)
  return parsed?.content ?? ''
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/**
 * Crawl a GitLab project's source files, chunk + embed them and upsert the
 * embeddings into the `embeddings` table.
 *
 * Strategy: delete-then-insert per file (atomic per file). A file whose content
 * hash is unchanged is skipped (no re-embedding). Once every file has been
 * processed, orphan rows (files removed from the repo) are deleted. The whole
 * operation is idempotent: a partial failure leaves the table consistent
 * file-by-file and a re-run reconverges.
 */
export async function indexRepositoryFiles(opts: IndexOptions): Promise<IndexResult> {
  const projectId = String(opts.projectId)
  const mcpUrl =
    opts.mcpGitlabUrl || process.env.NUXT_MCP_GITLAB_URL || 'http://localhost:3001'

  const client = await connectGitlab(mcpUrl)
  let filesIndexed = 0
  let filesSkipped = 0
  let chunksUpserted = 0

  try {
    const ref = opts.ref ?? (await resolveRef(client, projectId))
    const paths = await listSourceFiles(client, projectId, ref)
    const total = paths.length
    logger.info(`[indexer] ${total} fichier(s) indexable(s) sur project ${projectId}@${ref}`)

    const seen: string[] = []

    for (let i = 0; i < total; i++) {
      const path = paths[i] as string
      logger.info(`[indexer] (${i + 1}/${total}) ${path}`)

      const content = await readFileContent(client, projectId, path, ref)
      if (content.trim().length === 0) continue

      const hash = hashContent(content)

      const existing = await query<{ content_hash: string | null }>(
        'SELECT content_hash FROM embeddings WHERE project_id = $1 AND source_type = $2 AND source_path = $3 LIMIT 1',
        [opts.projectId, SOURCE_TYPE, path]
      )
      if (existing.rows.length > 0 && existing.rows[0]?.content_hash === hash) {
        filesSkipped++
        seen.push(path)
        continue
      }

      const chunks = chunkText(content)
      if (chunks.length === 0) continue

      const vectors = await embedText(chunks)

      await withClient(async (db) => {
        await db.query(
          'DELETE FROM embeddings WHERE project_id = $1 AND source_type = $2 AND source_path = $3',
          [opts.projectId, SOURCE_TYPE, path]
        )
        for (let c = 0; c < chunks.length; c++) {
          await db.query(
            'INSERT INTO embeddings (project_id, source_type, source_path, content, content_hash, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector)',
            [opts.projectId, SOURCE_TYPE, path, chunks[c], hash, toVectorLiteral(vectors[c] as number[])]
          )
        }
      })

      filesIndexed++
      chunksUpserted += chunks.length
      seen.push(path)
    }

    const orphans = await query(
      'DELETE FROM embeddings WHERE project_id = $1 AND source_type = $2 AND source_path <> ALL($3::text[])',
      [opts.projectId, SOURCE_TYPE, seen]
    )
    if (orphans.rowCount) {
      logger.info(`[indexer] ${orphans.rowCount} chunk(s) orphelin(s) supprimé(s)`)
    }
  } finally {
    await client.close()
  }

  logger.info(
    `[indexer] terminé : ${filesIndexed} indexé(s), ${filesSkipped} inchangé(s), ${chunksUpserted} chunk(s)`
  )
  return { filesIndexed, filesSkipped, chunksUpserted }
}
