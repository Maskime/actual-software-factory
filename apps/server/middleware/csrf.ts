import { defineEventHandler, getMethod, getRequestURL, getHeader, createError } from 'h3'
import { createConsola } from 'consola'

const logger = createConsola({ level: 4 }).withTag('csrf')
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

function trustedHosts(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(o => hostOf(o) ?? o)
}

export default defineEventHandler((event) => {
  const method = getMethod(event)
  if (SAFE_METHODS.has(method)) return

  const { pathname, host: selfHost } = getRequestURL(event)
  // NextAuth (authjs) gère sa propre protection CSRF sur /api/auth/**
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return

  const config = useRuntimeConfig(event)
  const originHost = hostOf(getHeader(event, 'origin')) ?? hostOf(getHeader(event, 'referer'))
  const allowed = [selfHost, ...trustedHosts((config.csrfTrustedOrigins as string) || '')]

  if (!originHost || !allowed.includes(originHost)) {
    logger.warn(
      `CSRF rejeté : ${method} ${pathname} origin=${originHost ?? 'absent'} attendu∈[${allowed.join(', ')}]`,
    )
    throw createError({ statusCode: 403, message: 'Requête cross-origin refusée (CSRF)' })
  }
})
