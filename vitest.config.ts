import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    // Run tests from root - each package defines its own include pattern
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/tests/**/*.test.ts',
      'apps/*/**/*.test.ts',
    ],
  },
})
