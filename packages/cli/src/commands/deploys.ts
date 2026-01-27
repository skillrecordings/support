import { execSync } from 'child_process'
import { Command } from 'commander'

const VERCEL_SCOPE = 'skillrecordings'

// Map of app names to their Vercel project names
const APPS: Record<string, { vercel: string; description: string }> = {
  front: {
    vercel: 'skill-support-agent-front',
    description: 'Front webhook handler (main support pipeline)',
  },
  slack: {
    vercel: 'slack',
    description: 'Slack interactions (approvals, notifications)',
  },
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\].*?\x07/g, '')
}

function runVercel(args: string): string {
  try {
    // Capture both stdout and stderr (Vercel CLI writes table to stderr)
    const raw = execSync(`vercel ${args} --scope ${VERCEL_SCOPE} --yes 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    }).trim()
    return stripAnsi(raw)
  } catch (err: any) {
    const out = err.stdout?.trim() || err.stderr?.trim() || err.message
    return stripAnsi(out)
  }
}

function listApps() {
  console.log('\n📦 Support Platform Apps\n')
  for (const [name, app] of Object.entries(APPS)) {
    console.log(
      `  ${name.padEnd(10)} ${app.vercel.padEnd(35)} ${app.description}`
    )
  }
  console.log()
}

function resolveApp(
  nameOrAll: string | undefined
): [string, { vercel: string; description: string }][] {
  if (!nameOrAll || nameOrAll === 'all') {
    return Object.entries(APPS)
  }
  const app = APPS[nameOrAll]
  if (!app) {
    console.error(`❌ Unknown app: ${nameOrAll}`)
    console.error(`   Available: ${Object.keys(APPS).join(', ')}, all`)
    process.exit(1)
  }
  return [[nameOrAll, app]]
}

async function deploysStatus(
  appName: string | undefined,
  options: { limit?: string; json?: boolean }
) {
  const apps = resolveApp(appName)
  const limit = parseInt(options.limit || '5')

  for (const [name, app] of apps) {
    console.log(`\n🚀 ${name} (${app.vercel})`)
    console.log(`   ${app.description}\n`)

    const output = runVercel(`ls ${app.vercel}`)
    const lines = output.split('\n')
    // Deploy lines contain https:// URLs
    const deployLines = lines.filter((l) => l.includes('https://'))

    if (deployLines.length === 0) {
      console.log('   No recent deployments found')
    } else {
      // Filter production-only for cleaner output, show all if few deploys
      const prodLines = deployLines.filter((l) => l.includes('Production'))
      const showLines = (
        prodLines.length >= limit ? prodLines : deployLines
      ).slice(0, limit)

      for (const line of showLines) {
        const trimmed = line.trim()
        // Extract known tokens from the line
        const hasReady = trimmed.includes('Ready')
        const hasError = trimmed.includes('Error')
        const hasCanceled = trimmed.includes('Canceled')
        const isProd = trimmed.includes('Production')
        const isPreview = trimmed.includes('Preview')
        const prefix = hasError
          ? '❌'
          : hasCanceled
            ? '⚪'
            : isProd
              ? '🟢'
              : '🔵'

        // Pull age (first token) and environment
        const age = trimmed.split(/\s+/)[0] || ''
        const status = hasError
          ? 'Error'
          : hasCanceled
            ? 'Canceled'
            : hasReady
              ? 'Ready'
              : 'Unknown'
        const env = isProd ? 'Production' : isPreview ? 'Preview' : ''

        // Pull duration (pattern like "30s", "17s")
        const durMatch = trimmed.match(/(\d+s)/)
        const duration = durMatch ? durMatch[1] : ''

        console.log(
          `   ${prefix} ${age.padEnd(6)} ${status.padEnd(10)} ${env.padEnd(12)} ${duration}`
        )
      }
    }
  }
  console.log()
}

async function deploysLogs(appName: string, options: { lines?: string }) {
  const apps = resolveApp(appName)
  if (apps.length > 1) {
    console.error('❌ Specify a single app for logs (front or slack)')
    process.exit(1)
  }

  const [name, app] = apps[0]!
  console.log(`\n📋 Recent logs for ${name} (${app.vercel})\n`)

  // Get latest production deployment URL
  const lsOutput = runVercel(`ls ${app.vercel} --limit 5`)
  const prodLine = lsOutput
    .split('\n')
    .find((l) => l.includes('Production') && l.includes('Ready'))
  const urlMatch = prodLine?.match(/https:\/\/\S+/)

  if (!urlMatch) {
    console.error('   Could not find latest production deployment')
    process.exit(1)
  }

  const url = urlMatch[0]
  console.log(`   Deployment: ${url}\n`)

  try {
    const logsOutput = execSync(
      `vercel logs ${url} --scope ${VERCEL_SCOPE} --output short 2>&1 | tail -${options.lines || '30'}`,
      { encoding: 'utf-8', timeout: 30000 }
    )
    console.log(logsOutput)
  } catch (err: any) {
    console.log(err.stdout || err.message)
  }
}

async function deploysInspect(appName: string) {
  const apps = resolveApp(appName)
  if (apps.length > 1) {
    console.error('❌ Specify a single app for inspect (front or slack)')
    process.exit(1)
  }

  const [name, app] = apps[0]!

  // Get latest production deployment URL
  const lsOutput = runVercel(`ls ${app.vercel} --limit 3`)
  const prodLine = lsOutput
    .split('\n')
    .find((l) => l.includes('Production') && l.includes('Ready'))
  const urlMatch = prodLine?.match(/https:\/\/\S+/)

  if (!urlMatch) {
    console.error('   Could not find latest production deployment')
    process.exit(1)
  }

  console.log(`\n🔍 Inspecting ${name} latest production deploy\n`)
  const output = runVercel(`inspect ${urlMatch[0]}`)
  console.log(output)
}

export function registerDeployCommands(program: Command) {
  const deploys = program
    .command('deploys')
    .description('Check Vercel deployment status for support platform apps')

  deploys
    .command('status')
    .description('Show recent deployments for one or all apps')
    .argument('[app]', 'App name (front, slack, all)', 'all')
    .option('-n, --limit <number>', 'Number of deploys to show', '5')
    .option('--json', 'JSON output')
    .action(deploysStatus)

  deploys
    .command('logs')
    .description('Show recent logs for an app')
    .argument('<app>', 'App name (front, slack)')
    .option('-n, --lines <number>', 'Number of log lines', '30')
    .action(deploysLogs)

  deploys
    .command('inspect')
    .description('Inspect latest production deployment')
    .argument('<app>', 'App name (front, slack)')
    .action(deploysInspect)

  // Default: `deploys` with no subcommand = status all
  deploys.action(() => deploysStatus('all', { limit: '3' }))
}
