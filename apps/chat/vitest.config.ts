import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    name: 'chat',
    environment: 'jsdom',
    include: ['app/**/*.test.ts', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'app/utils/**/*.ts',
        'app/components/**/*.vue',
        'app/pages/**/*.vue',
        'server/**/*.ts',
      ],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
})
