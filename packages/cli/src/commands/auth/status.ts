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
export async function statusAction(options: StatusOptions): Promise<void> {
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

  if (options.json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }

  // Human-readable output
  console.log('Auth Status\n')
  console.log(`Active Provider: ${status.activeProvider}`)
  console.log(
    `OP_SERVICE_ACCOUNT_TOKEN: ${status.opServiceAccountToken.configured ? 'configured' : 'not set'}`
  )

  console.log('\nSecrets:')
  for (const secret of status.secrets) {
    console.log(
      `  ${secret.key}: ${secret.available ? '✓' : '✗'} (${secret.source})`
    )
  }

  if (status.missingSecrets.length > 0) {
    console.log('\nMissing Secrets:')
    for (const secret of status.missingSecrets) {
      console.log(`  - ${secret}`)
    }
  }
}
