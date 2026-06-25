import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/**/fixtures/**'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
