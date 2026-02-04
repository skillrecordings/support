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

const writeResult = (options: LoginOptions, result: LoginResult): void => {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (!result.success) {
    console.error(`Error: ${result.error ?? 'Failed to validate token.'}`)
    return
  }

  console.log('1Password token validated.')
  console.log(`Provider: ${result.provider}`)
}

export async function loginAction(options: LoginOptions): Promise<void> {
  const token = options.token ?? process.env.OP_SERVICE_ACCOUNT_TOKEN

  if (!token) {
    writeResult(options, {
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
    writeResult(options, {
      success: false,
      provider: provider.name,
      tokenConfigured: true,
      error: 'Unable to authenticate with 1Password using this token.',
    })
    process.exitCode = 1
    return
  }

  writeResult(options, {
    success: true,
    provider: provider.name,
    tokenConfigured: true,
  })
}
