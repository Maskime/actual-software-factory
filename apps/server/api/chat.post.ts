import { defineEventHandler, readBody, setResponseHeader, sendStream, createError } from 'h3'
import Anthropic from '@anthropic-ai/sdk'
import { getToken } from '#auth'
import { QUALIFICATION_PROMPT } from '../prompts/qualification'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_FILE_CHARS = 50_000
const GITLAB_FETCH_TIMEOUT_MS = 3_000

async function fetchGitLabFileRaw(
  baseUrl: string,
  token: string,
  projectId: number,
  filename: string,
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GITLAB_FETCH_TIMEOUT_MS)
  try {
    const url = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(filename)}/raw?ref=HEAD`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) : text
  } catch {
    // network error, timeout, or 4xx — degrade silently
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function buildProjectContext(
  event: Parameters<typeof getToken>[0]['event'],
  projectId: number,
  config: ReturnType<typeof useRuntimeConfig>,
): Promise<string | null> {
  // The user's OAuth token is the authorization gate: GitLab returns 403 for inaccessible projects.
  const tokenData = await getToken({ event })
  if (!tokenData?.accessToken) return null

  const baseUrl = (config.gitlabInternalUrl as string) || (config.gitlabUrl as string)
  const accessToken = tokenData.accessToken as string

  const [readme, claudeMd] = await Promise.all([
    fetchGitLabFileRaw(baseUrl, accessToken, projectId, 'README.md'),
    fetchGitLabFileRaw(baseUrl, accessToken, projectId, 'CLAUDE.md'),
  ])

  if (!readme && !claudeMd) return null

  const parts: string[] = ['## Contexte du projet']
  if (readme) {
    parts.push('### README.md', readme)
  }
  if (claudeMd) {
    parts.push('### CLAUDE.md', claudeMd)
  }
  return parts.join('\n\n')
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ messages?: ChatMessage[]; projectId?: number }>(event)
  const config = useRuntimeConfig(event)

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, message: 'messages array is required' })
  }

  if (!config.anthropicApiKey) {
    throw createError({ statusCode: 500, message: 'ANTHROPIC_API_KEY is not configured' })
  }

  const model = (config.anthropicModel as string) || DEFAULT_MODEL
  const systemPrompt = (config.anthropicSystemPrompt as string) || QUALIFICATION_PROMPT

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ]

  if (body.projectId) {
    const projectContext = await buildProjectContext(event, body.projectId, config)
    if (projectContext) {
      systemBlocks.push({ type: 'text', text: projectContext })
    }
  }

  setResponseHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')

  const client = new Anthropic({ apiKey: config.anthropicApiKey as string })
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = client.messages.stream({
          model,
          max_tokens: 4096,
          system: systemBlocks,
          messages: body.messages!,
        })

        for await (const chunk of anthropicStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk.delta.text)}\n\n`))
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        const message =
          err instanceof Anthropic.APIError
            ? `Erreur API Anthropic : ${err.message}`
            : 'Erreur interne du serveur'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify('[ERROR] ' + message)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return sendStream(event, stream)
})
