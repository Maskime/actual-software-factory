export interface UserStoryData {
  title: string
  description: string
  acceptance_criteria: string[]
  technical_notes?: string
}

export interface EpicData {
  epic_title: string
  epic_description: string
  user_stories: UserStoryData[]
}

export type SSEEpicEvent = { __epic_data: EpicData }

export function parseSSELine(line: string): string | null | undefined | SSEEpicEvent {
  if (!line.startsWith('data: ')) return undefined
  const value = line.slice(6).trimEnd()
  if (value === '[DONE]') return null
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'string') return parsed
    if (parsed !== null && typeof parsed === 'object' && '__epic_data' in parsed) {
      return parsed as SSEEpicEvent
    }
    return undefined
  } catch {
    return value
  }
}
