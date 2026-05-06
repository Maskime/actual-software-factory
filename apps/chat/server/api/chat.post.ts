import { defineEventHandler, readBody, setResponseHeader, sendStream, createError } from 'h3'
import Anthropic from '@anthropic-ai/sdk'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_SYSTEM_PROMPT = 'Tu es un assistant de qualification de besoins logiciels pour la Software Factory.'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ messages?: ChatMessage[] }>(event)
  const config = useRuntimeConfig(event)

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, message: 'messages array is required' })
  }

  if (!config.anthropicApiKey) {
    throw createError({ statusCode: 500, message: 'ANTHROPIC_API_KEY is not configured' })
  }

  const model = (config.anthropicModel as string) || DEFAULT_MODEL
  const systemPrompt = (config.anthropicSystemPrompt as string) || DEFAULT_SYSTEM_PROMPT

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
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
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
