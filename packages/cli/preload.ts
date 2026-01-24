import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenvFlow from 'dotenv-flow'

// Load env from the CLI package directory before anything else
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenvFlow.config({ path: __dirname })
