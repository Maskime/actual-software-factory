import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatInput from './ChatInput.vue'

function mountInput(disabled = false) {
  return mount(ChatInput, { props: { disabled } })
}

describe('ChatInput — canSend', () => {
  it('is false when text is empty', async () => {
    const w = mountInput()
    expect(w.find('button').attributes('disabled')).toBeDefined()
  })

  it('is false when text is only whitespace', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('   ')
    expect(w.find('button').attributes('disabled')).toBeDefined()
  })

  it('is true when text has content and not disabled', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('hello')
    expect(w.find('button').attributes('disabled')).toBeUndefined()
  })

  it('is false when disabled even with text', async () => {
    const w = mountInput(true)
    await w.find('textarea').setValue('hello')
    expect(w.find('button').attributes('disabled')).toBeDefined()
  })
})

describe('ChatInput — submit()', () => {
  it('does not emit send when canSend is false', async () => {
    const w = mountInput()
    await w.find('button').trigger('click')
    expect(w.emitted('send')).toBeFalsy()
  })

  it('emits send with trimmed text', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('  hello  ')
    await w.find('button').trigger('click')
    expect(w.emitted('send')).toEqual([['hello']])
  })

  it('resets text to empty after send', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('hello')
    await w.find('button').trigger('click')
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
})

describe('ChatInput — handleKeydown()', () => {
  it('calls preventDefault and submits on Enter', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('hello')
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true })
    const prevented = { called: false }
    event.preventDefault = () => { prevented.called = true }
    w.find('textarea').element.dispatchEvent(event)
    await w.vm.$nextTick()
    expect(prevented.called).toBe(true)
    expect(w.emitted('send')).toEqual([['hello']])
  })

  it('does not submit on Shift+Enter', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('hello')
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
    const prevented = { called: false }
    event.preventDefault = () => { prevented.called = true }
    w.find('textarea').element.dispatchEvent(event)
    await w.vm.$nextTick()
    expect(prevented.called).toBe(false)
    expect(w.emitted('send')).toBeFalsy()
  })

  it('does nothing on other keys', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('hello')
    await w.find('textarea').trigger('keydown', { key: 'a' })
    expect(w.emitted('send')).toBeFalsy()
  })
})
