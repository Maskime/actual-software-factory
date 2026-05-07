import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, defineComponent, Suspense, h, computed } from 'vue'
import Dashboard from './index.vue'
import type { GitLabIssue } from '../../../../server/api/projects/[id]/issues.get'

vi.stubGlobal('useRoute', () => ({ params: { id: '3' } }))
vi.stubGlobal('useAuth', () => ({ signOut: vi.fn() }))
vi.stubGlobal('computed', computed)

const projects = [{ id: 3, name: 'Software Factory', description: null, web_url: '' }]

const allIssues: GitLabIssue[] = [
  { iid: 1, title: 'No label issue',   labels: [],                   state: 'opened', web_url: '' },
  { iid: 2, title: 'Dev issue',        labels: ['workflow::dev'],    state: 'opened', web_url: '' },
  { iid: 3, title: 'Review issue',     labels: ['workflow::review'], state: 'opened', web_url: '' },
  { iid: 4, title: 'Fix issue',        labels: ['workflow::fix'],    state: 'opened', web_url: '' },
  { iid: 5, title: 'Sonar issue',      labels: ['workflow::sonarqube'], state: 'opened', web_url: '' },
  { iid: 6, title: 'Merged issue',     labels: ['workflow::merged'], state: 'closed', web_url: '' },
  { iid: 7, title: 'Multi-label',      labels: ['workflow::dev', 'bug'], state: 'opened', web_url: '' },
  { iid: 8, title: 'Unknown workflow', labels: ['workflow::unknown'], state: 'opened', web_url: '' },
  { iid: 9, title: 'Closed no label',  labels: ['epic-01', 'user-story'], state: 'closed', web_url: '' },
]

function stubUseFetch(issues: GitLabIssue[], status = 'success', error: unknown = null) {
  vi.stubGlobal('useFetch', vi.fn().mockImplementation((url: string) => {
    if (url === '/api/projects') {
      return Promise.resolve({ data: ref(projects), status: ref('success'), error: ref(null) })
    }
    return Promise.resolve({ data: ref(issues), status: ref(status), error: ref(error) })
  }))
}

function mountPage() {
  return mount(defineComponent({
    render: () => h(Suspense, null, { default: () => h(Dashboard) }),
  }), {
    global: {
      stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } },
    },
  })
}

describe('Dashboard — header', () => {
  beforeEach(() => stubUseFetch([]))

  it('shows project name in header', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.find('.brand-name').text()).toBe('Software Factory')
  })

  it('falls back to default name when project not found', async () => {
    vi.stubGlobal('useRoute', () => ({ params: { id: '999' } }))
    const w = mountPage()
    await flushPromises()
    expect(w.find('.brand-name').text()).toBe('Actual Software Factory')
    vi.stubGlobal('useRoute', () => ({ params: { id: '3' } }))
  })

  it('shows a "Nouveau besoin" button linking to the chat page', async () => {
    const w = mountPage()
    await flushPromises()
    const btn = w.find('.btn-new')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('href')).toBe('/projects/3/chat')
    expect(btn.text()).toContain('Nouveau besoin')
  })
})

describe('Dashboard — loading state', () => {
  it('shows spinner while pending', async () => {
    stubUseFetch([], 'pending')
    const w = mountPage()
    await flushPromises()
    expect(w.find('.spinner').exists()).toBe(true)
  })
})

describe('Dashboard — error state', () => {
  it('shows error bar on fetch failure', async () => {
    stubUseFetch([], 'error', new Error('Network error'))
    const w = mountPage()
    await flushPromises()
    expect(w.find('.err-bar').exists()).toBe(true)
    expect(w.text()).toContain('Impossible de récupérer les issues')
  })
})

describe('Dashboard — columns', () => {
  beforeEach(() => stubUseFetch(allIssues))

  it('renders 6 columns', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('.col')).toHaveLength(6)
  })

  it('places opened issue without workflow:: label in Ouvert column', async () => {
    const w = mountPage()
    await flushPromises()
    const cols = w.findAll('.col')
    const ouvertCol = cols[0]
    expect(ouvertCol!.text()).toContain('No label issue')
    expect(ouvertCol!.text()).toContain('Unknown workflow')
  })

  it('places closed issue without workflow::merged label in Mergé column', async () => {
    const w = mountPage()
    await flushPromises()
    const mergedCol = w.findAll('.col')[5]
    expect(mergedCol!.text()).toContain('Closed no label')
    expect(mergedCol!.text()).toContain('Merged issue')
  })

  it('places workflow::dev issue in Dev en cours column', async () => {
    const w = mountPage()
    await flushPromises()
    const cols = w.findAll('.col')
    expect(cols[1]!.text()).toContain('Dev issue')
    expect(cols[1]!.text()).toContain('Multi-label')
  })

  it('places workflow::review issue in Review column', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('.col')[2]!.text()).toContain('Review issue')
  })

  it('places workflow::fix issue in Correctifs column', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('.col')[3]!.text()).toContain('Fix issue')
  })

  it('places workflow::sonarqube issue in Analyse SonarQube column', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('.col')[4]!.text()).toContain('Sonar issue')
  })

  it('places workflow::merged issue in Mergé column', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('.col')[5]!.text()).toContain('Merged issue')
  })
})

describe('Dashboard — issue cards', () => {
  beforeEach(() => stubUseFetch(allIssues))

  it('shows issue number on each card', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.find('.card-num').text()).toMatch(/^#\d+$/)
  })

  it('shows issue title on each card', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Dev issue')
  })

  it('shows non-workflow labels as badges', async () => {
    const w = mountPage()
    await flushPromises()
    const devCol = w.findAll('.col')[1]
    const multiCard = devCol!.findAll('.card').find(c => c.text().includes('Multi-label'))
    expect(multiCard).toBeDefined()
    const badges = multiCard!.findAll('.badge')
    const badgeTexts = badges.map(b => b.text())
    expect(badgeTexts).toContain('bug')
  })

  it('shows workflow label as workflow badge', async () => {
    const w = mountPage()
    await flushPromises()
    const devCol = w.findAll('.col')[1]
    const devCard = devCol!.findAll('.card')[0]
    expect(devCard!.find('.badge--workflow').exists()).toBe(true)
  })

  it('column count badge reflects number of issues', async () => {
    const w = mountPage()
    await flushPromises()
    const cols = w.findAll('.col')
    // Ouvert: 2 issues (iid=1 no label opened, iid=8 unknown workflow opened)
    expect(cols[0]!.find('.col-count').text()).toBe('2')
    // Dev en cours: 2 issues (iid=2, iid=7)
    expect(cols[1]!.find('.col-count').text()).toBe('2')
    // Mergé: 2 issues (iid=6 workflow::merged, iid=9 closed no label)
    expect(cols[5]!.find('.col-count').text()).toBe('2')
  })
})
