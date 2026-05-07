export function parseSSELine(line: string): string | null | undefined {
  if (!line.startsWith('data: ')) return undefined
  const value = line.slice(6).trimEnd()
  if (value === '[DONE]') return null
  try {
    return JSON.parse(value) as string
  } catch {
    return value
  }
}
