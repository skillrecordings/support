import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'apps/web',
  'apps/front',
  'apps/slack',
  'apps/docs',
  'packages/core',
  'packages/sdk',
  'packages/cli',
])
