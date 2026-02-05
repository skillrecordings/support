declare module '@1password/sdk' {
  export type OnePasswordSecretsClient = {
    resolve: (reference: string) => Promise<string>
    resolveAll?: (references: string[]) => Promise<unknown>
  }

  export type OnePasswordClient = {
    secrets: OnePasswordSecretsClient
  }

  export function createClient(options: {
    auth: string
    integrationName?: string
    integrationVersion?: string
  }): Promise<OnePasswordClient>
}
