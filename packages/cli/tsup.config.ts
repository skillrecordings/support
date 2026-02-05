import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const version = pkg.version ?? '0.0.0'

// Get git commit
let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
} catch {
  // Not in a git repo or git not available
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  shims: true,
  // Inject build-time version info
  define: {
    BUILD_VERSION: JSON.stringify(version),
    BUILD_COMMIT: JSON.stringify(commit),
    BUILD_TARGET: JSON.stringify('node'),
  },
  // Bundle workspace deps (they're not published to npm)
  noExternal: [
    '@skillrecordings/core',
    '@skillrecordings/database',
    '@skillrecordings/front-sdk',
    '@skillrecordings/memory',
  ],
  // Native modules must be installed at runtime
  external: [
    'duckdb',
    'mysql2',
    '@duckdb/node-bindings',
    '@mapbox/node-pre-gyp',
  ],
})
