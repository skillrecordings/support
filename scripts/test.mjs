import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)

const command = args.length === 0
  ? ['turbo', 'run', 'test']
  : ['vitest', '--run', ...args]

const result = spawnSync(command[0], command.slice(1), {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
