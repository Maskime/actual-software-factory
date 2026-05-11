import { defineEventHandler, getMethod, getRequestURL } from 'h3'
import { createConsola } from 'consola'

const logger = createConsola({ level: 4 }).withTag('http')

export default defineEventHandler(async (event) => {
  const start = Date.now()
  const method = getMethod(event)
  const url = getRequestURL(event)

  event.node.res.on('finish', () => {
    const status = event.node.res.statusCode
    const duration = Date.now() - start
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    logger[level](`${method} ${url.pathname} ${status} +${duration}ms`)
  })
})
