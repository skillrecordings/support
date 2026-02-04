import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const distDir = join(rootDir, 'dist')
const entrypoint = join(rootDir, 'src', 'index.ts')

const defaultTargets = [
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-darwin-x64',
  'bun-darwin-arm64',
] as const
type Target = (typeof defaultTargets)[number]

const resolveTargets = (): Target[] => {
  const rawTargets = process.env.BUILD_TARGETS ?? process.env.BUILD_TARGET
  if (!rawTargets) {
    return [...defaultTargets]
  }

  const requested = rawTargets
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean) as Target[]

  const allowed = new Set<Target>(defaultTargets)
  const unknown = requested.filter((target) => !allowed.has(target))
  if (unknown.length > 0) {
    throw new Error(`Unknown build targets: ${unknown.join(', ')}`)
  }

  return requested
}

const external = [
  // MySQL — mysql2 has dynamic requires that bypass bundler externals
  'mysql2',
  'mysql2/promise',
  'lru.min',
  // DuckDB — native bindings per-platform
  'duckdb',
  '@duckdb/node-api',
  '@duckdb/node-bindings',
  '@duckdb/node-bindings-linux-x64',
  '@duckdb/node-bindings-linux-arm64',
  '@duckdb/node-bindings-darwin-x64',
  '@duckdb/node-bindings-darwin-arm64',
  '@duckdb/node-bindings-win32-x64',
  // Native/platform-specific
  '@mapbox/node-pre-gyp',
  '@1password/sdk',
]

const getPackageVersion = async () => {
  const pkgRaw = await readFile(join(rootDir, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgRaw) as { version?: string }
  return pkg.version ?? '0.0.0'
}

const getGitCommit = async () => {
  const result = Bun.spawnSync({
    cmd: ['git', 'rev-parse', '--short', 'HEAD'],
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    return 'unknown'
  }

  return result.stdout.toString().trim() || 'unknown'
}

const buildTarget = async (target: Target) => {
  const version = await getPackageVersion()
  const commit = await getGitCommit()
  const outfile = join(distDir, `skill-${target}`)

  // Use bun CLI for compilation — the programmatic Bun.build API has issues
  // with compile:true + bytecode on Bun 1.3.x ("src is a directory" error)
  const args = [
    'build',
    entrypoint,
    '--compile',
    '--outfile',
    outfile,
    '--target',
    target,
    '--minify',
    ...external.flatMap((dep) => ['--external', dep]),
    // Embed version info via --define
    '--define',
    `BUILD_VERSION=${JSON.stringify(JSON.stringify(version))}`,
    '--define',
    `BUILD_COMMIT=${JSON.stringify(JSON.stringify(commit))}`,
    '--define',
    `BUILD_TARGET=${JSON.stringify(JSON.stringify(target))}`,
  ]

  console.log(`Building ${target}...`)
  const result = Bun.spawnSync({
    cmd: ['bun', ...args],
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    console.error(`Build failed for ${target}:`, stderr)
    throw new Error(`Build failed for ${target}: ${stderr}`)
  }

  const stdout = result.stdout.toString()
  if (stdout) console.log(stdout.trim())
  console.log(`✅ ${target} → ${outfile}`)
}

const main = async () => {
  await mkdir(distDir, { recursive: true })

  const version = await getPackageVersion()
  const commit = await getGitCommit()
  console.log(`\n🔨 Building skill-cli v${version} (${commit})\n`)

  for (const target of resolveTargets()) {
    await buildTarget(target)
  }

  console.log(`\n✅ All targets built successfully!\n`)
}

await main()
