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

  // [FOR_VALIDATION] tag behaviour
  it('does not show submit button without showSubmit prop', () => {
    const w = mount(ChatMessage, { props: { role: 'assistant', content: 'hello [FOR_VALIDATION]' } })
    expect(w.find('.msg-submit-btn').exists()).toBe(false)
  })

  it('shows two submit buttons when showSubmit=true and content has [FOR_VALIDATION]', () => {
    const w = mount(ChatMessage, {
      props: { role: 'assistant', content: 'hello [FOR_VALIDATION]', showSubmit: true, isSubmitting: false },
    })
    expect(w.findAll('.msg-submit-btn').length).toBe(2)
  })

  it('does not show submit button when content has no [FOR_VALIDATION] tag', () => {
    const w = mount(ChatMessage, {
      props: { role: 'assistant', content: 'hello', showSubmit: true, isSubmitting: false },
    })
    expect(w.find('.msg-submit-btn').exists()).toBe(false)
  })

  it('does not show submit button for user messages even with showSubmit and tag', () => {
    const w = mount(ChatMessage, {
      props: { role: 'user', content: 'hello [FOR_VALIDATION]', showSubmit: true },
    })
    expect(w.find('.msg-submit-btn').exists()).toBe(false)
  })

  it('strips [FOR_VALIDATION] from rendered HTML', () => {
    const w = mount(ChatMessage, {
      props: { role: 'assistant', content: 'hello [FOR_VALIDATION]', showSubmit: true },
    })
    expect(w.html()).not.toContain('[FOR_VALIDATION]')
  })

  it('disables submit button when isSubmitting=true', () => {
    const w = mount(ChatMessage, {
      props: { role: 'assistant', content: 'hello [FOR_VALIDATION]', showSubmit: true, isSubmitting: true },
    })
    const btns = w.findAll('.msg-submit-btn')
    expect(btns.length).toBe(2)
    btns.forEach(btn => expect(btn.attributes('disabled')).toBeDefined())
  })

  it('emits submit event when submit button is clicked', async () => {
    const w = mount(ChatMessage, {
      props: { role: 'assistant', content: 'hello [FOR_VALIDATION]', showSubmit: true, isSubmitting: false },
    })
    await w.find('.msg-submit-btn').trigger('click')
    expect(w.emitted('submit')).toBeTruthy()
  })
})
