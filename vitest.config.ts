import { createRequire } from 'node:module'

const { defineConfig } = createRequire('/Users/superhacker/Codefield/Work/Codefield/deepseek-harness-rich-editor-m1/package.json')('vitest/config') as typeof import('vitest/config')

export default defineConfig({
  test: {
    include: ['/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/tests/**/*.spec.ts'],
  },
})
