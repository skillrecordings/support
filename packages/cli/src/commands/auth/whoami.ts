import { createHash } from 'node:crypto'
import { type CommandContext } from '../../core/context'
import { OnePasswordProvider } from '../../core/secrets'

interface WhoamiOptions {
  json?: boolean
}

type TokenInfo = {
  format: 'jwt' | 'opaque'
  fingerprint: string
  claims?: Record<string, unknown>
}

type WhoamiResult = {
  success: boolean
  provider: string
  tokenConfigured: boolean
  token?: TokenInfo
  error?: string
}

const fingerprintToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 12)

const decodeBase64Url = (value: string): string | null => {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4

  if (padding === 1) return null
  if (padding === 2) normalized += '=='
  if (padding === 3) normalized += '='

  try {
    return Buffer.from(normalized, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

const parseToken = (token: string): TokenInfo => {
  const fingerprint = fingerprintToken(token)
  const parts = token.split('.')

  if (parts.length !== 3) {
    return { format: 'opaque', fingerprint }
  }

  try {
    const payloadPart = parts[1]

    if (!payloadPart) {
      return { format: 'opaque', fingerprint }
    }

    const decoded = decodeBase64Url(payloadPart)

    if (!decoded) {
      return { format: 'opaque', fingerprint }
    }

    const payload = JSON.parse(decoded) as Record<string, unknown>

    return { format: 'jwt', fingerprint, claims: payload }
  } catch {
    return { format: 'opaque', fingerprint }
  }
}

const formatEpoch = (value: unknown): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString()
}

const renderClaims = (claims: Record<string, unknown>): string[] => {
  const keys = [
    'iss',
    'sub',
    'aud',
    'account_id',
    'service_account_id',
    'workspace_id',
    'jti',
    'iat',
    'exp',
  ]

  return keys.flatMap((key) => {
    if (!(key in claims)) return []
    const value = claims[key]
    if (key === 'iat' || key === 'exp') {
      const formatted = formatEpoch(value)
      return formatted ? [`${key}: ${formatted}`] : []
    }
    return [`${key}: ${String(value)}`]
  })
}

const writeResult = (
  ctx: CommandContext,
  options: WhoamiOptions,
  result: WhoamiResult
): void => {
  const outputJson = options.json === true || ctx.format === 'json'

  if (outputJson) {
    ctx.output.data(result)
    return
  }

  if (!result.success) {
    ctx.output.error(result.error ?? 'Failed to load account info.')
    return
  }

  ctx.output.data('Service Account')
  ctx.output.data(`Provider: ${result.provider}`)

  if (result.token) {
    ctx.output.data(`Token format: ${result.token.format}`)
    ctx.output.data(`Token fingerprint: ${result.token.fingerprint}`)
    if (result.token.claims && result.token.format === 'jwt') {
      const claims = renderClaims(result.token.claims)
      if (claims.length > 0) {
        ctx.output.data('Claims:')
        for (const line of claims) {
          ctx.output.data(`  ${line}`)
        }
      }
    }
  }
}

export async function whoamiAction(
  ctx: CommandContext,
  options: WhoamiOptions
): Promise<void> {
  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN

  if (!token) {
    writeResult(ctx, options, {
      success: false,
      provider: '1password',
      tokenConfigured: false,
      error:
        'OP_SERVICE_ACCOUNT_TOKEN not set. Set the environment variable to continue.',
    })
    process.exitCode = 1
    return
  }

  const provider = new OnePasswordProvider()
  const available = await provider.isAvailable()

  if (!available) {
    writeResult(ctx, options, {
      success: false,
      provider: provider.name,
      tokenConfigured: true,
      error: 'Unable to authenticate with 1Password using this token.',
    })
    process.exitCode = 1
    return
  }

  writeResult(ctx, options, {
    success: true,
    provider: provider.name,
    tokenConfigured: true,
    token: parseToken(token),
  })
}
