import { defineEventHandler, readBody, setResponseHeader, sendStream } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ message: string }>(event)
  setResponseHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')

  const words = `[Stub] Vous avez écrit : ${body.message}`.split(' ')
  const encoder = new TextEncoder()

  // 80ms between words — slow enough to make streaming visible
  const stream = new ReadableStream({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(encoder.encode(`data: ${word} \n\n`))
        await new Promise<void>((r) => setTimeout(r, 80))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return sendStream(event, stream)
})
