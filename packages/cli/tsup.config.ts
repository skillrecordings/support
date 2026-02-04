import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    preload: 'preload.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  shims: true,
  // Bundle workspace deps (they're not published to npm)
  noExternal: [
    '@skillrecordings/core',
    '@skillrecordings/database',
    '@skillrecordings/front-sdk',
    '@skillrecordings/memory',
    '@skillrecordings/sdk',
  ],
  // Native modules must be installed at runtime
  external: [
    'duckdb',
    'mysql2',
    '@duckdb/node-bindings',
    '@mapbox/node-pre-gyp',
  ],
})
