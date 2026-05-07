import { getToken } from '#auth'
import { defineEventHandler, createError } from 'h3'

export interface GitLabIssue {
  iid: number
  title: string
  labels: string[]
  state: string
  web_url: string
}

export default defineEventHandler(async (event) => {
  const token = await getToken({ event })
  if (!token?.accessToken) {
    throw createError({ statusCode: 401, message: 'Non authentifié' })
  }

  const config = useRuntimeConfig(event)
  const baseUrl = (config.gitlabInternalUrl as string) || (config.gitlabUrl as string)
  const projectId = event.context.params?.id

  const res = await fetch(
    `${baseUrl}/api/v4/projects/${projectId}/issues?per_page=100&state=all`,
    { headers: { Authorization: `Bearer ${token.accessToken}` } },
  )

  if (!res.ok) {
    throw createError({ statusCode: 502, message: 'Erreur GitLab API' })
  }

  const raw: GitLabIssue[] = await res.json()
  return raw.map(i => ({
    iid: i.iid,
    title: i.title,
    labels: i.labels,
    state: i.state,
    web_url: i.web_url,
  }))
})
