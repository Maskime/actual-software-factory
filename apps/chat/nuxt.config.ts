export default defineNuxtConfig({
  future: {
    compatibilityVersion: 4,
  },
  modules: ['@nuxtjs/tailwindcss'],
  devtools: { enabled: false },
  runtimeConfig: {
    anthropicApiKey: '',
    anthropicModel: '',
    anthropicSystemPrompt: '',
  },
})
