interface GitLabProject {
  id: number
  name: string
  description: string | null
  web_url: string
}

export default defineNuxtRouteMiddleware(async () => {
  const fetchWithCookies = useRequestFetch()
  try {
    const projects = await fetchWithCookies<GitLabProject[]>('/api/projects')
    const first = projects[0]
    if (first && projects.length === 1) return navigateTo(`/projects/${first.id}`, { replace: true })
    if (projects.length > 1) return navigateTo('/projects', { replace: true })
  } catch {
    // 0 projects or API error — index.vue handles the display
  }
})
