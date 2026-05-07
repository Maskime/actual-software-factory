import { getToken } from '#auth'
import { defineEventHandler, readBody, createError } from 'h3'

interface SubmitBody {
  title: string
  description: string
}

export default defineEventHandler(async (event) => {
  const token = await getToken({ event })
  if (!token?.accessToken) {
    throw createError({ statusCode: 401, message: 'Non authentifié' })
  }

  const body = await readBody<SubmitBody>(event)
  if (!body?.title || !body?.description) {
    throw createError({ statusCode: 400, message: 'title et description requis' })
  }

  const config = useRuntimeConfig(event)
  const baseUrl = (config.gitlabInternalUrl as string) || (config.gitlabUrl as string)
  const projectId = event.context.params?.id

  if (!/^\d+$/.test(projectId ?? '')) {
    throw createError({ statusCode: 400, message: 'projectId invalide' })
  }

  const title = body.title.slice(0, 255)

  const res = await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, description: body.description }),
  })

  if (!res.ok) {
    throw createError({ statusCode: 502, message: 'Erreur GitLab API' })
  }

  const issue = await res.json()
  return { url: issue.web_url as string, iid: issue.iid as number }
})
