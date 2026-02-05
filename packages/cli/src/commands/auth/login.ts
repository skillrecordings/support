import { type CommandContext } from '../../core/context'
import { OnePasswordProvider } from '../../core/secrets'

interface LoginOptions {
  token?: string
  json?: boolean
}

type LoginResult = {
  success: boolean
  provider: string
  tokenConfigured: boolean
  error?: string
}

const writeResult = (
  ctx: CommandContext,
  options: LoginOptions,
  result: LoginResult
): void => {
  const outputJson = options.json === true || ctx.format === 'json'

  if (outputJson) {
    ctx.output.data(result)
    return
  }

  if (!result.success) {
    ctx.output.error(result.error ?? 'Failed to validate token.')
    return
  }

  ctx.output.data('1Password token validated.')
  ctx.output.data(`Provider: ${result.provider}`)
}

export async function loginAction(
  ctx: CommandContext,
  options: LoginOptions
): Promise<void> {
  const token = options.token ?? process.env.OP_SERVICE_ACCOUNT_TOKEN

  if (!token) {
    writeResult(ctx, options, {
      success: false,
      provider: '1password',
      tokenConfigured: false,
      error:
        'OP_SERVICE_ACCOUNT_TOKEN not set. Provide --token or set the environment variable.',
    })
    process.exitCode = 1
    return
  }

  if (options.token) {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = token
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
  })
}
