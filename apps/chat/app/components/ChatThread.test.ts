import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatThread from './ChatThread.vue'

const messages = [
  { role: 'user' as const, content: 'hello' },
  { role: 'assistant' as const, content: 'world' },
]

describe('ChatThread', () => {
  it('renders all messages', () => {
    const w = mount(ChatThread, { props: { messages, isStreaming: false } })
    expect(w.text()).toContain('hello')
    expect(w.text()).toContain('world')
  })

  it('shows typing indicator when streaming and last message is empty', () => {
    const streaming = [...messages, { role: 'assistant' as const, content: '' }]
    const w = mount(ChatThread, { props: { messages: streaming, isStreaming: true } })
    expect(w.find('.streaming-cursor').exists()).toBe(true)
  })

  it('hides typing indicator when not streaming', () => {
    const w = mount(ChatThread, { props: { messages, isStreaming: false } })
    expect(w.find('.streaming-cursor').exists()).toBe(false)
  })

  it('hides typing indicator when streaming but last message has content', () => {
    const w = mount(ChatThread, { props: { messages, isStreaming: true } })
    expect(w.find('.streaming-cursor').exists()).toBe(false)
  })
})
