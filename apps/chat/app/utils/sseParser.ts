export function parseSSELine(line: string): string | null | undefined {
  if (!line.startsWith('data: ')) return undefined
  const value = line.slice(6).trimEnd()
  return value === '[DONE]' ? null : value
}
