import { getToken } from '#auth'
import { defineEventHandler, createError, readBody } from 'h3'
import type { EpicData } from '../../app/utils/sseParser'

interface SubmitBody {
  projectId: number
  epicData: EpicData
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

  const epicRes = await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `[EPIC] ${epicData.epic_title}`,
      description: epicData.epic_description,
      labels: 'epic',
    }),
  })

  if (!epicRes.ok) {
    const detail = await epicRes.text()
    throw createError({ statusCode: 502, message: `Erreur création epic GitLab : ${detail}` })
  }

  const epic: { iid: number; web_url: string } = await epicRes.json()

  const createdIssues: Array<{ iid: number; title: string; web_url: string }> = []

  for (const us of epicData.user_stories) {
    const criteriaBlock = us.acceptance_criteria.length > 0
      ? `\n\n## Critères d'acceptance\n\n${us.acceptance_criteria.map(c => `- ${c}`).join('\n')}`
      : ''

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

      // Create a "relates_to" link between the user story and the epic issue
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
    epic: { iid: epic.iid, web_url: epic.web_url, title: epicData.epic_title },
    issues: createdIssues,
  }
})
