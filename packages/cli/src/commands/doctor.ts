import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { createContext } from '../core/context'
import { getFromKeychain, isOpCliAvailable } from '../core/keychain'

interface HealthCheck {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message?: string
}

interface HealthCheckCategory {
  category: string
  checks: HealthCheck[]
}

interface HealthCheckResults {
  status: 'healthy' | 'degraded' | 'unhealthy'
  categories: HealthCheckCategory[]
  summary: {
    total: number
    ok: number
    warn: number
    fail: number
  }
}

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'INNGEST_SIGNING_KEY',
  'INNGEST_EVENT_KEY',
  'FRONT_API_TOKEN',
  'LINEAR_API_KEY',
  'AXIOM_TOKEN',
  'SLACK_BOT_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_VECTOR_REST_URL',
] as const

function checkEnvVars(): HealthCheck[] {
  return REQUIRED_ENV_VARS.map((varName) => {
    const value = process.env[varName]
    return {
      name: varName,
      status: value ? 'ok' : 'warn',
      message: value ? undefined : 'Not set',
    }
  })
}

function checkKeychain(): HealthCheck[] {
  const checks: HealthCheck[] = []

  // Check if op CLI is available
  const opAvailable = isOpCliAvailable()
  checks.push({
    name: 'op CLI',
    status: opAvailable ? 'ok' : 'warn',
    message: opAvailable ? undefined : 'Not installed or not authenticated',
  })

  // Check for op service token in keychain
  const opToken = getFromKeychain('op-service-account-token')
  checks.push({
    name: 'op-service-account-token',
    status: opToken ? 'ok' : 'warn',
    message: opToken ? undefined : 'Not found in keychain',
  })

  // Check for age private key in keychain
  const ageKey = getFromKeychain('age-private-key')
  checks.push({
    name: 'age-private-key',
    status: ageKey ? 'ok' : 'warn',
    message: ageKey ? undefined : 'Not found in keychain',
  })

  return checks
}

function checkTools(): HealthCheck[] {
  const checks: HealthCheck[] = []

  // Check gh CLI
  try {
    execSync('gh auth status', { stdio: 'pipe', timeout: 3000 })
    checks.push({
      name: 'gh CLI',
      status: 'ok',
    })
  } catch {
    checks.push({
      name: 'gh CLI',
      status: 'warn',
      message: 'Not installed or not authenticated',
    })
  }

  return checks
}

function checkWorkspace(): HealthCheck[] {
  const checks: HealthCheck[] = []

  // Check for .hive directory
  const hivePath = join(process.cwd(), '.hive')
  const hiveExists = existsSync(hivePath)
  checks.push({
    name: '.hive directory',
    status: hiveExists ? 'ok' : 'warn',
    message: hiveExists ? undefined : 'Not found in current directory',
  })

  return checks
}

function runHealthChecks(): HealthCheckResults {
  const categories: HealthCheckCategory[] = [
    {
      category: 'Environment',
      checks: checkEnvVars(),
    },
    {
      category: 'Keychain',
      checks: checkKeychain(),
    },
    {
      category: 'Tools',
      checks: checkTools(),
    },
    {
      category: 'Workspace',
      checks: checkWorkspace(),
    },
  ]

  // Calculate summary
  let total = 0
  let ok = 0
  let warn = 0
  let fail = 0

  for (const category of categories) {
    for (const check of category.checks) {
      total++
      if (check.status === 'ok') ok++
      else if (check.status === 'warn') warn++
      else fail++
    }
  }

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy'
  if (fail > 0) {
    status = 'unhealthy'
  } else if (warn > 3) {
    status = 'degraded'
  } else {
    status = 'healthy'
  }

  return {
    status,
    categories,
    summary: { total, ok, warn, fail },
  }
}

function formatTextOutput(results: HealthCheckResults): void {
  // Print header
  console.log('\n🩺 Health Check Results\n')

  // Print categories
  for (const category of results.categories) {
    console.log(`${category.category}:`)
    for (const check of category.checks) {
      const symbol =
        check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗'
      const line = check.message
        ? `  ${symbol} ${check.name} - ${check.message}`
        : `  ${symbol} ${check.name}`
      console.log(line)
    }
    console.log('')
  }

  // Print summary
  console.log('─'.repeat(60))
  console.log(
    `Summary: ${results.summary.ok}/${results.summary.total} checks passed`
  )
  if (results.summary.warn > 0) {
    console.log(`⚠ ${results.summary.warn} warnings`)
  }
  if (results.summary.fail > 0) {
    console.log(`✗ ${results.summary.fail} failures`)
  }
  console.log(`\nOverall status: ${results.status.toUpperCase()}`)
  console.log('')
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      'Run health checks on environment and tools\n\n' +
        '  Checks:\n' +
        '  - Environment variables\n' +
        '  - Keychain secrets\n' +
        '  - CLI tools (gh, op)\n' +
        '  - Workspace setup (.hive)\n\n' +
        '  Examples:\n' +
        '    skill doctor\n' +
        '    skill doctor --json'
    )
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await createContext({
        format: options.json ? 'json' : 'text',
        verbose: command.optsWithGlobals().verbose,
        quiet: command.optsWithGlobals().quiet,
      })

      const results = runHealthChecks()

      if (options.json || ctx.format === 'json') {
        ctx.output.data(results)
      } else {
        formatTextOutput(results)
      }
    })
}
