import { getToken } from '#auth'
import { defineEventHandler, createError, readBody } from 'h3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { EpicData } from '../../app/utils/sseParser'

interface SubmitBody {
  projectId: number
  epicData: EpicData
}

interface EpicResult {
  iid: number
  id: number
  title: string
  web_url: string
}

async function createEpicViaMcp(
  mcpUrl: string,
  projectId: string,
  title: string,
  description: string
): Promise<EpicResult> {
  const client = new Client({ name: 'portal', version: '1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`))
  await client.connect(transport)
  try {
    const result = await client.callTool({
      name: 'gitlab_create_epic',
      arguments: { project_id: projectId, title, description },
    })
    const content = result.content as Array<{ type: string; text: string }>
    if (result.isError) {
      const detail = content[0]?.text ?? 'Erreur inconnue'
      throw new Error(detail)
    }
    const text = content[0]?.text ?? '{}'
    return JSON.parse(text) as EpicResult
  } finally {
    await client.close()
  }
}

export default defineEventHandler(async (event) => {
  const token = await getToken({ event })
  if (!token?.accessToken) {
    throw createError({ statusCode: 401, message: 'Non authentifié' })
  }

  const body = await readBody<SubmitBody>(event)
  if (!body?.projectId || !body?.epicData) {
    throw createError({ statusCode: 400, message: 'projectId et epicData sont requis' })
  }

  const { epicData, projectId } = body
  const config = useRuntimeConfig(event)
  const baseUrl = (config.gitlabInternalUrl as string) || (config.gitlabUrl as string)
  const accessToken = token.accessToken as string
  const mcpGitlabUrl = config.mcpGitlabUrl as string
  const targetProjectId = String((config.gitlabProjectId as string) || projectId)

  let epic: EpicResult
  try {
    epic = await createEpicViaMcp(
      mcpGitlabUrl,
      targetProjectId,
      epicData.epic_title,
      epicData.epic_description ?? ''
    )
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw createError({ statusCode: 502, message: `Erreur MCP création epic : ${detail}` })
  }

  const createdIssues: Array<{ iid: number; title: string; web_url: string }> = []

  for (const us of epicData.user_stories) {
    const criteriaLines = us.acceptance_criteria.map(c => `- ${c}`).join('\n')
    const criteriaBlock = criteriaLines ? `\n\n## Critères d'acceptance\n\n${criteriaLines}` : ''

    const issueRes = await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: us.title,
        description: `${us.description}${criteriaBlock}\n\n---\n\n_Lié à l'epic #${epic.iid}_`,
        labels: 'user-story',
      }),
    })

    if (issueRes.ok) {
      const issue: { iid: number; title: string; web_url: string } = await issueRes.json()
      createdIssues.push({ iid: issue.iid, title: issue.title, web_url: issue.web_url })

      await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues/${issue.iid}/links`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_project_id: projectId,
          target_issue_iid: epic.iid,
          link_type: 'relates_to',
        }),
      })
    }
  }

  return {
    epic: { iid: epic.iid, web_url: epic.web_url, title: epic.title },
    issues: createdIssues,
  }
})
