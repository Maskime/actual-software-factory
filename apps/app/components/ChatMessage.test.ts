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
    expect(w.find('div').classes()).toContain('msg-user-wrap')
  })

  it('aligns assistant message to the left', () => {
    const w = mount(ChatMessage, { props: { role: 'assistant', content: 'reply' } })
    expect(w.find('div').classes()).toContain('msg-asst-wrap')
  })

  it('renders assistant markdown as HTML', () => {
    const w = mount(ChatMessage, { props: { role: 'assistant', content: '**bold**' } })
    expect(w.html()).toContain('<strong>bold</strong>')
  })

  it('user message stays as plain text (no HTML rendering)', () => {
    const w = mount(ChatMessage, { props: { role: 'user', content: '**not bold**' } })
    expect(w.find('.user-text').text()).toContain('**not bold**')
    expect(w.html()).not.toContain('<strong>')
  })

  it('strips raw HTML blocks from assistant content', () => {
    const w = mount(ChatMessage, { props: { role: 'assistant', content: '<script>alert(1)</script>' } })
    expect(w.html()).not.toContain('<script>')
  })
})
