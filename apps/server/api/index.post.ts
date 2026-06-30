import { getToken } from '#auth'
import { defineEventHandler, createError, readBody } from 'h3'
import { createConsola } from 'consola'
import { indexRepositoryFiles, type IndexResult } from '../utils/indexer/files'
import { indexProjectIssues, type IssueIndexResult } from '../utils/indexer/issues'

const logger = createConsola({ level: 4 }).withTag('index')

interface IndexBody {
  projectId?: number
}

export default defineEventHandler(async (event) => {
  const token = await getToken({ event })
  if (!token?.accessToken) {
    throw createError({ statusCode: 401, message: 'Non authentifié' })
  }

  const body = await readBody<IndexBody>(event)
  const config = useRuntimeConfig(event)

  const projectId = Number(config.gitlabProjectId) || body?.projectId
  if (!projectId) {
    throw createError({ statusCode: 400, message: 'projectId est requis' })
  }

  const mcpGitlabUrl = config.mcpGitlabUrl as string

  try {
    logger.info(`indexation complète project ${projectId}`)
    const files: IndexResult = await indexRepositoryFiles({ projectId, mcpGitlabUrl })
    const issues: IssueIndexResult = await indexProjectIssues({ projectId, mcpGitlabUrl })
    logger.info(
      `indexation terminée : ${files.chunksUpserted} chunk(s) fichiers, ${issues.chunksUpserted} chunk(s) issues`,
    )
    return { files, issues }
  } catch (err) {
    logger.error('indexation échouée:', err)
    const detail = err instanceof Error ? err.message : String(err)
    throw createError({ statusCode: 502, message: `Erreur indexation : ${detail}` })
  }
})
