import { type CommandContext } from '../../core/context'
import { SECRET_REFS } from '../../core/secret-refs'
import { createSecretsProvider } from '../../core/secrets'

interface StatusOptions {
  json?: boolean
}

type SecretStatus = {
  key: string
  ref: string
  available: boolean
  source: '1password' | 'env'
}

interface AuthStatus {
  activeProvider: string
  opServiceAccountToken: {
    configured: boolean
  }
  secrets: SecretStatus[]
  availableSecrets: string[]
  missingSecrets: string[]
}

const resolveSecretStatus = async (
  providerName: string,
  provider: Awaited<ReturnType<typeof createSecretsProvider>>,
  key: string,
  ref: string
): Promise<SecretStatus> => {
  if (providerName === 'env') {
    return {
      key,
      ref,
      available: Boolean(process.env[key]),
      source: 'env',
    }
  }

  try {
    await provider.resolve(ref)
    return { key, ref, available: true, source: '1password' }
  } catch {
    return { key, ref, available: false, source: '1password' }
  }
}

/**
 * Check auth configuration status
 */
export async function statusAction(
  ctx: CommandContext,
  options: StatusOptions
): Promise<void> {
  const provider = await createSecretsProvider()
  const entries = Object.entries(SECRET_REFS)

  const secrets = await Promise.all(
    entries.map(([key, ref]) =>
      resolveSecretStatus(provider.name, provider, key, ref)
    )
  )

  const availableSecrets = secrets
    .filter((secret) => secret.available)
    .map((secret) => secret.key)
  const missingSecrets = secrets
    .filter((secret) => !secret.available)
    .map((secret) => secret.key)

  const status: AuthStatus = {
    activeProvider: provider.name,
    opServiceAccountToken: {
      configured: Boolean(process.env.OP_SERVICE_ACCOUNT_TOKEN),
    },
    secrets,
    availableSecrets,
    missingSecrets,
  }

  const outputJson = options.json === true || ctx.format === 'json'

  if (outputJson) {
    ctx.output.data(status)
    return
  }

  // Human-readable output
  ctx.output.data('Auth Status\n')
  ctx.output.data(`Active Provider: ${status.activeProvider}`)
  ctx.output.data(
    `OP_SERVICE_ACCOUNT_TOKEN: ${status.opServiceAccountToken.configured ? 'configured' : 'not set'}`
  )

  ctx.output.data('\nSecrets:')
  for (const secret of status.secrets) {
    ctx.output.data(
      `  ${secret.key}: ${secret.available ? '✓' : '✗'} (${secret.source})`
    )
  }

  if (status.missingSecrets.length > 0) {
    ctx.output.data('\nMissing Secrets:')
    for (const secret of status.missingSecrets) {
      ctx.output.data(`  - ${secret}`)
    }
  }
}
