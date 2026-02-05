import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { confirm, select } from '@inquirer/prompts'
import type { CommandContext } from '../../core/context'
import { AuthError, EXIT_CODES, formatError } from '../../core/errors'
import {
  ONEPASSWORD_ITEM_IDS,
  ONEPASSWORD_READ_REFS,
  ONEPASSWORD_VAULT_ID,
  buildOnePasswordItemLink,
  getOpVersion,
  opRead,
  opSignin,
  opVaultGet,
  opWhoami,
  openInBrowser,
} from '../../core/onepassword-links'
import { SECRET_REFS } from '../../core/secret-refs'
import { createSecretsProvider } from '../../core/secrets'

export interface AuthSetupOptions {
  token?: string
  ageKey?: string
  json?: boolean
}

type AuthSetupResult = {
  success: boolean
  tokenConfigured: boolean
  ageKeyConfigured: boolean
  envFile?: string
  error?: string
}

const AGE_KEY_PREFIX = 'AGE-SECRET-KEY-'

const isValidAgeKey = (value: string): boolean =>
  value.startsWith(AGE_KEY_PREFIX) && value.length > AGE_KEY_PREFIX.length

const missingOpMessage = `❌ 1Password CLI (op) is required but not found.

Install it:
  brew install 1password-cli        # macOS
  # or see https://developer.1password.com/docs/cli/get-started/

All Skill Recordings team members have vault access.
Once installed, run: skill auth setup`

const writeResult = (
  ctx: CommandContext,
  options: AuthSetupOptions,
  result: AuthSetupResult
): void => {
  const outputJson = options.json === true || ctx.format === 'json'

  if (outputJson) {
    ctx.output.data(result)
    return
  }

  if (!result.success) {
    ctx.output.error(result.error ?? 'Auth setup failed.')
    return
  }

  ctx.output.success('Secrets configured.')
  if (result.envFile) {
    ctx.output.data(`Saved to ${result.envFile}`)
  }
}

const handleAuthError = (
  ctx: CommandContext,
  options: AuthSetupOptions,
  error: AuthError
): void => {
  const outputJson = options.json === true || ctx.format === 'json'

  if (outputJson) {
    ctx.output.data({
      success: false,
      tokenConfigured: Boolean(process.env.OP_SERVICE_ACCOUNT_TOKEN),
      ageKeyConfigured: Boolean(process.env.AGE_SECRET_KEY),
      error: formatError(error),
    })
  } else {
    ctx.output.error(formatError(error))
  }

  process.exitCode = error.exitCode
}

const resolveOpSecret = async (options: {
  label: string
  reference: string
  itemId: string
  interactive: boolean
}): Promise<string> => {
  try {
    return opRead(options.reference)
  } catch (error) {
    if (options.interactive) {
      const shouldOpen = await confirm({
        message: `${options.label} could not be read via op CLI. Open in 1Password?`,
        default: true,
      })

      if (shouldOpen) {
        openInBrowser(buildOnePasswordItemLink(options.itemId))
      }
    }

    throw new AuthError({
      userMessage: `Unable to read ${options.label} via op CLI.`,
      suggestion: 'Confirm you have access to the Support vault and try again.',
      cause: error,
    })
  }
}

const formatAccountLabel = (account?: {
  url?: string
  domain?: string
  name?: string
}): string => account?.domain ?? account?.url ?? account?.name ?? 'unknown'

const printExportInstructions = (
  ctx: CommandContext,
  ageKey: string,
  token: string
): void => {
  ctx.output.data('\nAdd to your shell profile for persistence:')
  ctx.output.data(`  export AGE_SECRET_KEY="${ageKey}"`)
  ctx.output.data(`  export OP_SERVICE_ACCOUNT_TOKEN="${token}"`)
  ctx.output.data('\nOr use op CLI injection:')
  ctx.output.data('  op run --env-file=.env.op -- skill <command>')
}

export async function authSetupAction(
  ctx: CommandContext,
  options: AuthSetupOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const isInteractive = Boolean(ctx.stdin.isTTY && ctx.stdout.isTTY)

  const opVersion = getOpVersion()
  if (!opVersion) {
    if (outputJson) {
      ctx.output.data({
        success: false,
        tokenConfigured: false,
        ageKeyConfigured: false,
        error: '1Password CLI (op) is required but not found.',
      })
    } else {
      ctx.output.message(missingOpMessage)
    }
    process.exitCode = EXIT_CODES.auth
    return
  }

  if (!isInteractive && (!options.token || !options.ageKey) && !outputJson) {
    const error = new AuthError({
      userMessage:
        'Non-interactive mode requires --token and --age-key to be provided.',
      suggestion:
        'Re-run with --token and --age-key or use an interactive TTY.',
    })
    handleAuthError(ctx, options, error)
    return
  }

  if (!outputJson) {
    ctx.output.data('\n🔐 Setting up skill-cli secrets...\n')
    ctx.output.data('Checking 1Password CLI...')
    ctx.output.data(`  op CLI: ✅ ${opVersion} found`)
  }

  let whoami
  try {
    whoami = opWhoami()
  } catch (error) {
    if (!isInteractive) {
      const authError = new AuthError({
        userMessage: 'Not signed in to 1Password CLI.',
        suggestion: 'Run op signin and try again.',
        cause: error,
      })
      handleAuthError(ctx, options, authError)
      return
    }

    if (!outputJson) {
      ctx.output.data('  Signed in: ⏳ running op signin...')
    }

    try {
      opSignin()
      whoami = opWhoami()
    } catch (signinError) {
      const authError = new AuthError({
        userMessage: 'Unable to sign in to 1Password CLI.',
        suggestion: 'Run op signin manually and try again.',
        cause: signinError,
      })
      handleAuthError(ctx, options, authError)
      return
    }
  }

  if (!outputJson) {
    ctx.output.data(`  Signed in: ✅ ${formatAccountLabel(whoami?.account)}`)
  }

  try {
    opVaultGet(ONEPASSWORD_VAULT_ID)
    if (!outputJson) {
      ctx.output.data('  Support vault: ✅ accessible\n')
    }
  } catch (error) {
    const authError = new AuthError({
      userMessage: 'Unable to access Support vault in 1Password.',
      suggestion: 'Verify vault access and try again.',
      cause: error,
    })
    handleAuthError(ctx, options, authError)
    return
  }

  if (!outputJson) {
    ctx.output.data('Fetching secrets from 1Password...')
  }

  let ageKey = options.ageKey
  let token = options.token

  try {
    if (!ageKey) {
      ageKey = await resolveOpSecret({
        label: 'AGE_SECRET_KEY',
        reference: ONEPASSWORD_READ_REFS.ageKey,
        itemId: ONEPASSWORD_ITEM_IDS.ageKey,
        interactive: isInteractive && !outputJson,
      })
    }

    if (!token) {
      token = await resolveOpSecret({
        label: 'OP_SERVICE_ACCOUNT_TOKEN',
        reference: ONEPASSWORD_READ_REFS.serviceAccount,
        itemId: ONEPASSWORD_ITEM_IDS.serviceAccount,
        interactive: isInteractive && !outputJson,
      })
    }
  } catch (error) {
    const authError =
      error instanceof AuthError
        ? error
        : new AuthError({
            userMessage: 'Unable to fetch secrets from 1Password.',
            suggestion: 'Confirm op CLI access and try again.',
            cause: error,
          })

    handleAuthError(ctx, options, authError)
    return
  }

  if (!ageKey || !token) {
    const authError = new AuthError({
      userMessage: 'Missing secrets after fetching from 1Password.',
      suggestion: 'Re-run skill auth setup.',
    })
    handleAuthError(ctx, options, authError)
    return
  }

  if (!isValidAgeKey(ageKey)) {
    const authError = new AuthError({
      userMessage: 'AGE_SECRET_KEY format looks invalid.',
      suggestion: 'Re-run skill auth setup and fetch the correct key.',
    })
    handleAuthError(ctx, options, authError)
    return
  }

  if (!outputJson) {
    ctx.output.data('  AGE_SECRET_KEY: ✅ fetched')
    ctx.output.data('  OP_SERVICE_ACCOUNT_TOKEN: ✅ fetched\n')
  }

  process.env.AGE_SECRET_KEY = ageKey
  process.env.OP_SERVICE_ACCOUNT_TOKEN = token

  if (!outputJson) {
    ctx.output.data('Verifying access...')
    ctx.output.data('  AGE_SECRET_KEY format: ✅')
  }

  try {
    const provider = await createSecretsProvider()
    await provider.resolve(SECRET_REFS.DATABASE_URL)
    if (!outputJson) {
      ctx.output.data('  1Password SDK resolve: ✅\n')
    }
  } catch (error) {
    const authError = new AuthError({
      userMessage: 'Unable to resolve secrets with 1Password SDK.',
      suggestion: 'Verify OP_SERVICE_ACCOUNT_TOKEN and try again.',
      cause: error,
    })
    handleAuthError(ctx, options, authError)
    return
  }

  let envFile: string | undefined

  if (isInteractive && !outputJson) {
    const persistence = await select({
      message: 'Persist secrets for future commands?',
      choices: [
        { name: 'Write .env.local', value: 'env' },
        { name: 'Print shell export commands', value: 'exports' },
        { name: 'Skip (temporary for this session)', value: 'skip' },
      ],
    })

    if (persistence === 'env') {
      const envPath = resolve(process.cwd(), '.env.local')
      if (existsSync(envPath)) {
        const overwrite = await confirm({
          message: `.env.local already exists at ${envPath}. Overwrite?`,
          default: false,
        })
        if (!overwrite) {
          envFile = undefined
        } else {
          writeFileSync(
            envPath,
            `AGE_SECRET_KEY=${ageKey}\nOP_SERVICE_ACCOUNT_TOKEN=${token}\n`,
            'utf8'
          )
          envFile = envPath
        }
      } else {
        writeFileSync(
          envPath,
          `AGE_SECRET_KEY=${ageKey}\nOP_SERVICE_ACCOUNT_TOKEN=${token}\n`,
          'utf8'
        )
        envFile = envPath
      }
    }
  }

  if (!outputJson) {
    ctx.output.data('🎉 All set! Secrets configured.\n')
    printExportInstructions(ctx, ageKey, token)
  }

  writeResult(ctx, options, {
    success: true,
    tokenConfigured: true,
    ageKeyConfigured: true,
    envFile,
  })
}
