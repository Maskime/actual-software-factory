import { defineEventHandler, readBody, setResponseHeader, sendStream, createError } from 'h3'
import Anthropic from '@anthropic-ai/sdk'
import { getToken } from '#auth'
import { QUALIFICATION_PROMPT } from '../prompts/qualification'
import type { EpicData } from '../../app/utils/sseParser'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_FILE_CHARS = 50_000
const GITLAB_FETCH_TIMEOUT_MS = 3_000

const PROPOSE_EPIC_TOOL: Anthropic.Tool = {
  name: 'propose_epic',
  description: "Propose un epic GitLab avec ses user stories pour validation par l'utilisateur. Appelle cet outil dès que tu as suffisamment d'informations sur les 4 dimensions. Si l'utilisateur demande des corrections, rappelle-le avec les éléments corrigés.",
  input_schema: {
    type: 'object',
    properties: {
      epic_title: {
        type: 'string',
        description: "Titre court et descriptif de l'epic",
      },
      epic_description: {
        type: 'string',
        description: 'Description complète du besoin : contexte, objectif, contraintes techniques et critères de done',
      },
      user_stories: {
        type: 'array',
        description: '2 à 8 user stories couvrant le périmètre de l\'epic',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titre court de la user story' },
            description: { type: 'string', description: 'Format : "En tant que [rôle], je veux [action] afin de [bénéfice]"' },
            acceptance_criteria: {
              type: 'array',
              items: { type: 'string' },
              description: "Liste des critères d'acceptance",
            },
          },
          required: ['title', 'description', 'acceptance_criteria'],
        },
      },
    },
    required: ['epic_title', 'epic_description', 'user_stories'],
  },
}

function renderEpic(input: EpicData): string {
  const lines: string[] = [
    `## Epic : ${input.epic_title}`,
    '',
    input.epic_description,
    '',
    '---',
    '',
    '### User Stories',
    '',
  ]

  const usLines = input.user_stories.flatMap((us, i) => {
    const num = String(i + 1).padStart(2, '0')
    const criteriaLines = us.acceptance_criteria.length > 0
      ? ["**Critères d'acceptance :**", ...us.acceptance_criteria.map(c => `- ${c}`), '']
      : []
    return [`#### US-${num} — ${us.title}`, '', us.description, '', ...criteriaLines]
  })

  return [...lines, ...usLines, '[FOR_VALIDATION]'].join('\n')
}

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
  if (readme) parts.push('### README.md', readme)
  if (claudeMd) parts.push('### CLAUDE.md', claudeMd)
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
          tools: [PROPOSE_EPIC_TOOL],
          messages: body.messages!,
        })

        let currentBlockType: string | null = null
        let toolInputJson = ''

        for await (const chunk of anthropicStream) {
          if (chunk.type === 'content_block_start') {
            currentBlockType = chunk.content_block.type
            if (chunk.content_block.type === 'tool_use') {
              toolInputJson = ''
            }
          } else if (chunk.type === 'content_block_delta') {
            if (chunk.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk.delta.text)}\n\n`))
            } else if (chunk.delta.type === 'input_json_delta') {
              toolInputJson += chunk.delta.partial_json
            }
          } else if (chunk.type === 'content_block_stop') {
            if (currentBlockType === 'tool_use') {
              try {
                const epicData = JSON.parse(toolInputJson) as EpicData
                // Send structured data for the client to store (used at submit time)
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __epic_data: epicData })}\n\n`))
                // Send rendered Markdown with [FOR_VALIDATION] tag for display
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(renderEpic(epicData))}\n\n`))
              } catch {
                // malformed JSON — skip
              }
            }
            currentBlockType = null
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
