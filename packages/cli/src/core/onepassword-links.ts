import { execSync } from 'node:child_process'

export const ONEPASSWORD_ACCOUNT_ID = 'GCTJE4MRGFHKRAYXCEXKZKCEFU'
export const ONEPASSWORD_VAULT_ID = 'u3ujzar6l3nahlahsuzfvg7vcq'
export const ONEPASSWORD_HOST = 'egghead.1password.com'

export const ONEPASSWORD_DEEP_LINK_BASE =
  'https://start.1password.com/open/i' +
  `?a=${ONEPASSWORD_ACCOUNT_ID}&v=${ONEPASSWORD_VAULT_ID}&h=${ONEPASSWORD_HOST}`

export const ONEPASSWORD_ITEM_IDS = {
  ageKey: 'lxndka3exn475vqdiqq5heg2wm',
  serviceAccount: '3e4ip354ps3mhq2wwt6vmtm2zu',
} as const

export const ONEPASSWORD_READ_REFS = {
  ageKey: 'op://Support/skill-cli-age-key/password',
  serviceAccount: 'op://Support/skill-cli-service-account/credential',
} as const

export type OnePasswordWhoami = {
  account?: {
    url?: string
    domain?: string
    name?: string
  }
  user?: {
    email?: string
    name?: string
  }
}

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`

export const buildOnePasswordItemLink = (itemId: string): string =>
  `${ONEPASSWORD_DEEP_LINK_BASE}&i=${itemId}`

export const getOpVersion = (): string | null => {
  try {
    return execSync('op --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

export const opWhoami = (): OnePasswordWhoami => {
  const output = execSync('op whoami --format=json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return JSON.parse(output) as OnePasswordWhoami
}

export const opVaultGet = (vaultId: string): string =>
  execSync(`op vault get ${shellQuote(vaultId)} --format=json`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export const opRead = (reference: string): string =>
  execSync(`op read ${shellQuote(reference)}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export const opSignin = (): void => {
  execSync('op signin', { stdio: 'inherit' })
}

export const openInBrowser = (url: string): void => {
  if (process.platform === 'darwin') {
    execSync(`open ${shellQuote(url)}`, { stdio: 'ignore' })
    return
  }

  if (process.platform === 'win32') {
    execSync(`cmd /c start "" ${shellQuote(url)}`, { stdio: 'ignore' })
    return
  }

  execSync(`xdg-open ${shellQuote(url)}`, { stdio: 'ignore' })
}
