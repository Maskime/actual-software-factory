import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h } from 'vue'
import LoginPage from './login.vue'

const mockNavigateTo = vi.fn()
vi.stubGlobal('navigateTo', mockNavigateTo)

function mountLogin() {
  const wrapper = mount(defineComponent({
    render: () => h(Suspense, null, { default: () => h(LoginPage) }),
  }))
  return wrapper
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigateTo.mockReset()
  })

  it('renders the GitLab sign-in button', async () => {
    vi.stubGlobal('useAuth', () => ({
      signIn: vi.fn(),
      status: ref('unauthenticated'),
    }))
    const w = mountLogin()
    await flushPromises()
    expect(w.text()).toContain('Se connecter avec GitLab')
    expect(w.find('button').exists()).toBe(true)
  })

  it('calls signIn with gitlab provider on button click', async () => {
    const signIn = vi.fn()
    vi.stubGlobal('useAuth', () => ({
      signIn,
      status: ref('unauthenticated'),
    }))
    const w = mountLogin()
    await flushPromises()
    await w.find('button').trigger('click')
    expect(signIn).toHaveBeenCalledWith('gitlab', { callbackUrl: '/' })
  })

  it('redirects to / when already authenticated', async () => {
    vi.stubGlobal('useAuth', () => ({
      signIn: vi.fn(),
      status: ref('authenticated'),
    }))
    mountLogin()
    await flushPromises()
    expect(mockNavigateTo).toHaveBeenCalledWith('/')
  })
})
