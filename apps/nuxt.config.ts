export default defineNuxtConfig({
  future: {
    compatibilityVersion: 4,
  },
  app: {
    head: {
      titleTemplate: '%s — Software Factory',
      title: 'Software Factory',
    },
  },
  modules: ['@nuxtjs/tailwindcss', '@sidebase/nuxt-auth'],
  devtools: { enabled: false },
  auth: {
    provider: { type: 'authjs' },
    globalAppMiddleware: false,
    baseURL: process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth`
      : 'http://localhost:3000/api/auth',
  },
  runtimeConfig: {
    gitlabClientId: '',
    gitlabClientSecret: '',
    gitlabUrl: 'http://localhost',
    gitlabInternalUrl: '',
    anthropicApiKey: '',
    anthropicModel: '',
    anthropicSystemPrompt: '',
    mcpGitlabUrl: 'http://localhost:3001',
    gitlabProjectId: '',
    databaseUrl: '',
  },
})
