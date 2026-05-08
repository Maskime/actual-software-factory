import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  readBody: vi.fn(),
  createError: vi.fn((opts: { statusCode: number; message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }),
}))

vi.mock('#auth', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

import handler from './submit.post'
import * as h3 from 'h3'
import * as auth from '#auth'

const mockConfig = {
  gitlabUrl: 'http://gitlab.test',
  gitlabInternalUrl: '',
}

const mockEvent = {}

const sampleEpicData = {
  epic_title: 'Mon epic',
  epic_description: 'Description complète du besoin',
  user_stories: [
    {
      title: 'US-01 — Accès',
      description: 'En tant que user, je veux accéder à la page.',
      acceptance_criteria: ['La page est accessible', 'Un bouton est visible'],
    },
    {
      title: 'US-02 — Export',
      description: 'En tant que user, je veux exporter les données.',
      acceptance_criteria: [],
    },
  ],
}

function makeFetchSequence(responses: Array<{ ok: boolean; json?: object; text?: string }>) {
  let call = 0
  return vi.fn().mockImplementation(() => {
    const res = responses[call % responses.length]
    call++
    return Promise.resolve({
      ok: res.ok,
      json: () => Promise.resolve(res.json ?? {}),
      text: () => Promise.resolve(res.text ?? JSON.stringify(res.json ?? {})),
    })
  })
}

describe('submit.post handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useRuntimeConfig', vi.fn().mockReturnValue(mockConfig))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws 401 when not authenticated', async () => {
    vi.mocked(auth.getToken).mockResolvedValue(null)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 400 when body is missing epicData', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3 })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when body is missing projectId', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ epicData: sampleEpicData })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 502 when GitLab epic creation fails', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('Forbidden') }))

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('returns epic and issues on success', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    vi.stubGlobal('fetch', makeFetchSequence([
      { ok: true, json: { iid: 10, web_url: 'http://gitlab/issues/10' } },  // epic
      { ok: true, json: { iid: 11, title: 'US-01 — Accès', web_url: 'http://gitlab/issues/11' } },  // US-01
      { ok: true, json: {} },  // link US-01 → epic
      { ok: true, json: { iid: 12, title: 'US-02 — Export', web_url: 'http://gitlab/issues/12' } },  // US-02
      { ok: true, json: {} },  // link US-02 → epic
    ]))

    const result = await (handler as Function)(mockEvent)

    expect(result.epic.iid).toBe(10)
    expect(result.epic.title).toBe('Mon epic')
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0].iid).toBe(11)
    expect(result.issues[1].iid).toBe(12)
  })

  it('creates issue links after each user story', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 10, web_url: 'http://gitlab/issues/10' } },
      { ok: true, json: { iid: 11, title: 'US-01', web_url: 'http://gitlab/issues/11' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: 'http://gitlab/issues/12' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    // 1 epic + 2 issues + 2 links = 5 fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(5)

    // Link calls use the /links endpoint
    const linkCall1 = fetchMock.mock.calls[2]
    expect(linkCall1[0]).toContain('/issues/11/links')
    expect(JSON.parse(linkCall1[1].body)).toMatchObject({ target_issue_iid: 10, link_type: 'relates_to' })

    const linkCall2 = fetchMock.mock.calls[4]
    expect(linkCall2[0]).toContain('/issues/12/links')
  })

  it('includes acceptance criteria in issue description when present', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 10, web_url: '' } },
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const us01Body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(us01Body.description).toContain("Critères d'acceptance")
    expect(us01Body.description).toContain('- La page est accessible')

    // US-02 has no criteria — description should not contain the section
    const us02Body = JSON.parse(fetchMock.mock.calls[3][1].body)
    expect(us02Body.description).not.toContain("Critères d'acceptance")
  })

  it('uses [EPIC] prefix for the epic issue title', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 10, web_url: '' } },
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const epicBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(epicBody.title).toBe('[EPIC] Mon epic')
    expect(epicBody.labels).toBe('epic')
  })
})
