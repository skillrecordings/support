import { SECRET_REFS } from './secret-refs'

export interface SecretsProvider {
  name: string
  isAvailable(): Promise<boolean>
  resolve(ref: string): Promise<string>
  resolveAll(refs: string[]): Promise<Record<string, string>>
}

const REF_TO_ENV_KEY = new Map<string, string>(
  Object.entries(SECRET_REFS).map(([envKey, ref]) => [ref, envKey])
)

export const DEFAULT_SECRETS_PROVIDER: SecretsProvider = {
  name: 'none',
  async isAvailable() {
    return false
  },
  async resolve(ref: string) {
    throw new Error(`No secrets provider available for ${ref}`)
  },
  async resolveAll() {
    throw new Error('No secrets provider available')
  },
}

type OnePasswordSdk = typeof import('@1password/sdk')
type OnePasswordClient = Awaited<ReturnType<OnePasswordSdk['createClient']>>

type OnePasswordOptions = {
  integrationName?: string
  integrationVersion?: string
}

export class OnePasswordProvider implements SecretsProvider {
  name = '1password'
  private cache = new Map<string, string>()
  private clientPromise?: Promise<OnePasswordClient>
  private sdkPromise?: Promise<OnePasswordSdk>
  private integrationName: string
  private integrationVersion: string

  constructor(options: OnePasswordOptions = {}) {
    this.integrationName = options.integrationName ?? 'skill-cli'
    this.integrationVersion = options.integrationVersion ?? '0.0.0'
  }

  async isAvailable(): Promise<boolean> {
    if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
      return false
    }

    try {
      await this.getClient()
      return true
    } catch {
      return false
    }
  }

  async resolve(ref: string): Promise<string> {
    if (this.cache.has(ref)) {
      return this.cache.get(ref) as string
    }

    const client = await this.getClient()
    const secretsClient = client.secrets as {
      resolve: (reference: string) => Promise<string>
    }
    const value = await secretsClient.resolve(ref)

    if (!value) {
      throw new Error(`1Password returned empty secret for ${ref}`)
    }

    this.cache.set(ref, value)
    return value
  }

  async resolveAll(refs: string[]): Promise<Record<string, string>> {
    if (refs.length === 0) {
      return {}
    }

    const client = await this.getClient()
    const secrets = await this.resolveAllWithClient(client, refs)

    for (const [ref, value] of Object.entries(secrets)) {
      this.cache.set(ref, value)
    }

    return secrets
  }

  private async getClient(): Promise<OnePasswordClient> {
    if (this.clientPromise) {
      return this.clientPromise
    }

    const token = process.env.OP_SERVICE_ACCOUNT_TOKEN
    if (!token) {
      throw new Error('OP_SERVICE_ACCOUNT_TOKEN not set')
    }

    const { createClient } = await this.getSdk()

    this.clientPromise = createClient({
      auth: token,
      integrationName: this.integrationName,
      integrationVersion: this.integrationVersion,
    })

    return this.clientPromise
  }

  private async getSdk(): Promise<OnePasswordSdk> {
    if (this.sdkPromise) {
      return this.sdkPromise
    }

    this.sdkPromise = import('@1password/sdk')

    return this.sdkPromise
  }

  private async resolveAllWithClient(
    client: OnePasswordClient,
    refs: string[]
  ): Promise<Record<string, string>> {
    const secretsClient = client.secrets as {
      resolve: (reference: string) => Promise<string>
      resolveAll?: (references: string[]) => Promise<unknown>
    }

    if (typeof secretsClient.resolveAll === 'function') {
      const resolved = await secretsClient.resolveAll(refs)

      if (Array.isArray(resolved)) {
        const entries = resolved
          .map((item) => {
            if (
              item &&
              typeof item === 'object' &&
              'reference' in item &&
              'value' in item
            ) {
              return [
                (item as { reference: string }).reference,
                String((item as { value: string }).value),
              ] as const
            }
            return null
          })
          .filter((entry): entry is [string, string] => Boolean(entry))

        return Object.fromEntries(entries)
      }

      return resolved as Record<string, string>
    }

    const entries = await Promise.all(
      refs.map(async (ref) => [ref, await this.resolve(ref)] as const)
    )

    return Object.fromEntries(entries)
  }
}

export class EnvProvider implements SecretsProvider {
  name = 'env'

  async isAvailable(): Promise<boolean> {
    return true
  }

  async resolve(ref: string): Promise<string> {
    const envKey = REF_TO_ENV_KEY.get(ref)

    if (!envKey) {
      throw new Error(`No env mapping found for secret ref: ${ref}`)
    }

    const value = process.env[envKey]

    if (!value) {
      throw new Error(`Missing environment secret for ${envKey}`)
    }

    return value
  }

  async resolveAll(refs: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(
      refs.map(async (ref) => [ref, await this.resolve(ref)] as const)
    )

    return Object.fromEntries(entries)
  }
}

export async function createSecretsProvider(): Promise<SecretsProvider> {
  const onePassword = new OnePasswordProvider()

  if (await onePassword.isAvailable()) {
    return onePassword
  }

  return new EnvProvider()
}
