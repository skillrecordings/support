import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/types.ts',
    'src/integration.ts',
    'src/adapter.ts',
    'src/client.ts',
    'src/handler.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
