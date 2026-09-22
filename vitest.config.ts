import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      // Exact-match only: the test double re-exports the real published module
      // via its lib subpath, which must not be rewritten to itself.
      { find: /^@deepseek-ai\/dsh-client-ui-primitives$/, replacement: '/tests/helpers/dsh-primitives.ts' },
    ],
  },
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    testTimeout: 30_000,
    // The DSH primitives package loads CSS-module imports at entry; inline it
    // so Vite transforms them instead of Node hitting the raw .css file.
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/],
      },
    },
  },
})
