import { getToken } from '#auth'
import { defineEventHandler, createError } from 'h3'

export interface GitLabProject {
  id: number
  name: string
  description: string | null
  web_url: string
}

export default defineEventHandler(async (event) => {
  const token = await getToken({ event })
  if (!token?.accessToken) {
    throw createError({ statusCode: 401, message: 'Non authentifié' })
  }

  const config = useRuntimeConfig(event)
  const baseUrl = (config.gitlabInternalUrl as string) || (config.gitlabUrl as string)

  const res = await fetch(`${baseUrl}/api/v4/projects?membership=true`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  })

  if (!res.ok) {
    throw createError({ statusCode: 502, message: 'Erreur GitLab API' })
  }

  const raw: GitLabProject[] = await res.json()
  return raw.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    web_url: p.web_url,
  }))
})
