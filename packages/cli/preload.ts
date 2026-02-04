import { loadSecrets } from './src/lib/env-loader.js'

// Load env from the CLI package directory before anything else
await loadSecrets()
