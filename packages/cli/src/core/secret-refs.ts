export const SECRET_REFS = {
  AGE_SECRET_KEY: 'op://Support/skill-cli-age-key/private_key',
} as const

export type SecretRefKey = keyof typeof SECRET_REFS
export type SecretRef = (typeof SECRET_REFS)[SecretRefKey]
