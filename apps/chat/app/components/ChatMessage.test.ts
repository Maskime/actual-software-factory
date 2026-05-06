import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessage from './ChatMessage.vue'

describe('ChatMessage', () => {
  it('renders content', () => {
    const w = mount(ChatMessage, { props: { role: 'user', content: 'hello' } })
    expect(w.text()).toContain('hello')
  })

  it('aligns user message to the right', () => {
    const w = mount(ChatMessage, { props: { role: 'user', content: 'hi' } })
    expect(w.find('div').classes()).toContain('justify-end')
  })

  it('aligns assistant message to the left', () => {
    const w = mount(ChatMessage, { props: { role: 'assistant', content: 'reply' } })
    expect(w.find('div').classes()).toContain('justify-start')
  })
})
