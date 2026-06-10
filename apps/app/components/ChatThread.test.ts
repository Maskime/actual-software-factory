import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatThread from './ChatThread.vue'
import ChatMessage from './ChatMessage.vue'

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

  it('does not render an empty ChatMessage bubble while streaming', () => {
    const streaming = [...messages, { role: 'assistant' as const, content: '' }]
    const w = mount(ChatThread, { props: { messages: streaming, isStreaming: true } })
    const chatMessages = w.findAllComponents(ChatMessage)
    // Les 2 messages existants sont rendus, le placeholder vide ne l'est pas
    expect(chatMessages).toHaveLength(2)
  })

  it('hides typing indicator when not streaming', () => {
    const w = mount(ChatThread, { props: { messages, isStreaming: false } })
    expect(w.find('.streaming-cursor').exists()).toBe(false)
  })

  it('hides typing indicator when streaming but last message has content', () => {
    const w = mount(ChatThread, { props: { messages, isStreaming: true } })
    expect(w.find('.streaming-cursor').exists()).toBe(false)
  })

  it('shows submit buttons when canSubmit=true and a message has [FOR_VALIDATION]', () => {
    const msgs = [{ role: 'assistant' as const, content: 'Reformulation [FOR_VALIDATION]' }]
    const w = mount(ChatThread, { props: { messages: msgs, isStreaming: false, canSubmit: true, isSubmitting: false } })
    expect(w.findAll('.msg-submit-btn').length).toBe(2)
  })

  it('hides submit buttons when canSubmit=false', () => {
    const msgs = [{ role: 'assistant' as const, content: 'Reformulation [FOR_VALIDATION]' }]
    const w = mount(ChatThread, { props: { messages: msgs, isStreaming: false, canSubmit: false } })
    expect(w.find('.msg-submit-btn').exists()).toBe(false)
  })

  it('renders the last message as raw text while streaming, earlier ones as Markdown', () => {
    const msgs = [
      { role: 'assistant' as const, content: '**first**' },
      { role: 'assistant' as const, content: '**last**' },
    ]
    const w = mount(ChatThread, { props: { messages: msgs, isStreaming: true } })
    const html = w.html()
    // Earlier message keeps Markdown rendering
    expect(html).toContain('<strong>first</strong>')
    // Last (streaming) message stays raw
    expect(html).not.toContain('<strong>last</strong>')
    expect(w.find('.asst-text--streaming').exists()).toBe(true)
  })

  it('renders every message as Markdown when not streaming', () => {
    const msgs = [
      { role: 'assistant' as const, content: '**first**' },
      { role: 'assistant' as const, content: '**last**' },
    ]
    const w = mount(ChatThread, { props: { messages: msgs, isStreaming: false } })
    expect(w.html()).toContain('<strong>first</strong>')
    expect(w.html()).toContain('<strong>last</strong>')
    expect(w.find('.asst-text--streaming').exists()).toBe(false)
  })

  it('forwards submit event from ChatMessage to parent', async () => {
    const msgs = [{ role: 'assistant' as const, content: 'Reformulation [FOR_VALIDATION]' }]
    const w = mount(ChatThread, { props: { messages: msgs, isStreaming: false, canSubmit: true, isSubmitting: false } })
    await w.findComponent(ChatMessage).vm.$emit('submit')
    expect(w.emitted('submit')).toBeTruthy()
  })
})
