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

const mockCallTool = vi.fn()
const mockConnect = vi.fn()
const mockClose = vi.fn()

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    callTool: mockCallTool,
    close: mockClose,
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}))

import handler from './submit.post'
import * as h3 from 'h3'
import * as auth from '#auth'

const EPIC_MCP_RESPONSE = {
  isError: false,
  content: [{ type: 'text', text: JSON.stringify({ iid: 10, id: 100, title: '[EPIC] Mon epic', web_url: 'http://gitlab/issues/10' }) }],
}

const mockConfig = {
  gitlabUrl: 'http://gitlab.test',
  gitlabInternalUrl: '',
  mcpGitlabUrl: 'http://mcp.test',
  gitlabProjectId: '',
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
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockCallTool.mockResolvedValue(EPIC_MCP_RESPONSE)
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

  it('throws 502 when MCP epic creation fails', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })
    mockCallTool.mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'Forbidden' }] })
    vi.stubGlobal('fetch', vi.fn())

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('returns epic and issues on success', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    // fetch is only used for US creation and linking (epic goes via MCP)
    vi.stubGlobal('fetch', makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01 — Accès', web_url: 'http://gitlab/issues/11' } },
      { ok: true, json: {} },  // link US-01 → epic
      { ok: true, json: { iid: 12, title: 'US-02 — Export', web_url: 'http://gitlab/issues/12' } },
      { ok: true, json: {} },  // link US-02 → epic
    ]))

    const result = await (handler as Function)(mockEvent)

    expect(result.epic.iid).toBe(10)
    expect(result.epic.title).toBe('[EPIC] Mon epic')
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0].iid).toBe(11)
    expect(result.issues[1].iid).toBe(12)
  })

  it('creates issue links after each user story', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: 'http://gitlab/issues/11' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: 'http://gitlab/issues/12' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    // 2 issues + 2 links = 4 fetch calls (epic is via MCP)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    const linkCall1 = fetchMock.mock.calls[1]
    expect(linkCall1[0]).toContain('/issues/11/links')
    expect(JSON.parse(linkCall1[1].body)).toMatchObject({ target_issue_iid: 10, link_type: 'relates_to' })

    const linkCall2 = fetchMock.mock.calls[3]
    expect(linkCall2[0]).toContain('/issues/12/links')
  })

  it('includes acceptance criteria in issue description when present', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const us01Body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(us01Body.description).toContain("Critères d'acceptance")
    expect(us01Body.description).toContain('- [ ] La page est accessible')

    const us02Body = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(us02Body.description).not.toContain("Critères d'acceptance")
  })

  it('calls gitlab_create_epic MCP tool with correct arguments', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    vi.stubGlobal('fetch', makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ]))

    await (handler as Function)(mockEvent)

    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'gitlab_create_epic',
      arguments: {
        project_id: '3',
        title: 'Mon epic',
        description: 'Description complète du besoin',
      },
    })
  })

  it('throws 400 when epicData has fewer than 2 user stories (Zod validation)', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({
      projectId: 3,
      epicData: { ...sampleEpicData, user_stories: [sampleEpicData.user_stories[0]] },
    })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when epicData has more than 8 user stories (Zod validation)', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    const tooManyStories = Array.from({ length: 9 }, (_, i) => ({
      title: `US-${i}`,
      description: 'desc',
      acceptance_criteria: [],
    }))
    vi.mocked(h3.readBody).mockResolvedValue({
      projectId: 3,
      epicData: { ...sampleEpicData, user_stories: tooManyStories },
    })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when epicData structure is invalid (Zod validation)', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: { epic_title: 42 } })

    await expect((handler as Function)(mockEvent)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('uses label agent-ready on created issues', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const issueBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(issueBody.labels).toBe('agent-ready')
  })

  it('includes technical_notes block in issue description when present', async () => {
    const epicWithNotes = {
      ...sampleEpicData,
      user_stories: [
        { ...sampleEpicData.user_stories[0], technical_notes: 'Utiliser Redis pour le cache' },
        sampleEpicData.user_stories[1],
      ],
    }
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: epicWithNotes })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const us01Body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(us01Body.description).toContain('Notes techniques')
    expect(us01Body.description).toContain('Utiliser Redis pour le cache')

    const us02Body = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(us02Body.description).not.toContain('Notes techniques')
  })

  it('prefixes issue title with [EPIC-iid]', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: '[EPIC-10] US-01 — Accès', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: '[EPIC-10] US-02 — Export', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const us01Body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(us01Body.title).toBe('[EPIC-10] US-01 — Accès')

    const us02Body = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(us02Body.title).toBe('[EPIC-10] US-02 — Export')
  })

  it('includes context section in issue description when present', async () => {
    const epicWithContext = {
      ...sampleEpicData,
      user_stories: [
        { ...sampleEpicData.user_stories[0], context: 'Besoin métier de faciliter l\'accès' },
        sampleEpicData.user_stories[1],
      ],
    }
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: epicWithContext })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const us01Body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(us01Body.description).toContain('## Contexte')
    expect(us01Body.description).toContain('Besoin métier de faciliter l\'accès')

    const us02Body = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(us02Body.description).not.toContain('## Contexte')
  })

  it('includes technical_constraints section in issue description when present', async () => {
    const epicWithConstraints = {
      ...sampleEpicData,
      user_stories: [
        { ...sampleEpicData.user_stories[0], technical_constraints: 'Doit utiliser Redis pour le cache' },
        sampleEpicData.user_stories[1],
      ],
    }
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: epicWithConstraints })

    const fetchMock = makeFetchSequence([
      { ok: true, json: { iid: 11, title: 'US-01', web_url: '' } },
      { ok: true, json: {} },
      { ok: true, json: { iid: 12, title: 'US-02', web_url: '' } },
      { ok: true, json: {} },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await (handler as Function)(mockEvent)

    const us01Body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(us01Body.description).toContain('## Contraintes techniques')
    expect(us01Body.description).toContain('Doit utiliser Redis pour le cache')

    const us02Body = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(us02Body.description).not.toContain('## Contraintes techniques')
  })

  it('skips failed issue creation and does not add to createdIssues', async () => {
    vi.mocked(auth.getToken).mockResolvedValue({ accessToken: 'tok' } as any)
    vi.mocked(h3.readBody).mockResolvedValue({ projectId: 3, epicData: sampleEpicData })

    vi.stubGlobal('fetch', makeFetchSequence([
      { ok: false },              // US-01 creation fails
      { ok: true, json: { iid: 12, title: 'US-02', web_url: 'http://gitlab/issues/12' } },
      { ok: true, json: {} },     // link US-02 → epic
    ]))

    const result = await (handler as Function)(mockEvent)

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].iid).toBe(12)
  })
})
