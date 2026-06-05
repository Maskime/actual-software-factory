import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#auth': fileURLToPath(new URL('./server/__mocks__/nuxt-auth.ts', import.meta.url)),
    },
  },
  test: {
    name: 'chat',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/*.test.ts', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'app/utils/**/*.ts',
        'app/components/**/*.vue',
        'app/middleware/**/*.ts',
        'app/pages/**/*.vue',
        'server/**/*.ts',
      ],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
})
