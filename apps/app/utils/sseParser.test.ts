import { describe, it, expect } from 'vitest'
import { parseSSELine } from './sseParser'

describe('parseSSELine', () => {
  it('returns undefined for empty string', () => {
    expect(parseSSELine('')).toBeUndefined()
  })

  it('returns undefined for non-data prefix', () => {
    expect(parseSSELine('event: message')).toBeUndefined()
  })

  it('returns the token for a nominal data line', () => {
    expect(parseSSELine('data: hello')).toBe('hello')
  })

  it('trims trailing whitespace', () => {
    expect(parseSSELine('data: hello  ')).toBe('hello')
  })

  it('returns empty string when value is empty after prefix', () => {
    expect(parseSSELine('data: ')).toBe('')
  })

  it('returns null for [DONE] signal', () => {
    expect(parseSSELine('data: [DONE]')).toBeNull()
  })

  it('returns undefined when prefix has no space after colon', () => {
    expect(parseSSELine('data:hello')).toBeUndefined()
  })

  it('JSON-decodes a quoted string value', () => {
    expect(parseSSELine('data: "hello world"')).toBe('hello world')
  })

  it('JSON-decodes a string containing an escaped newline', () => {
    expect(parseSSELine('data: "line1\\nline2"')).toBe('line1\nline2')
  })

  it('returns an SSEEpicEvent object for __epic_data payload', () => {
    const epicData = {
      epic_title: 'Mon epic',
      epic_description: 'Description',
      user_stories: [{ title: 'US-01', description: 'En tant que...', acceptance_criteria: ['AC1'] }],
    }
    const line = `data: ${JSON.stringify({ __epic_data: epicData })}`
    const result = parseSSELine(line)
    expect(result).toEqual({ __epic_data: epicData })
  })

  it('returns undefined for a non-string, non-epic JSON object', () => {
    expect(parseSSELine('data: {"foo":"bar"}')).toBeUndefined()
  })
})
