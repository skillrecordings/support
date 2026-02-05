import { randomBytes, randomUUID } from 'node:crypto'
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import { type CommandContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

/**
 * All available capabilities an app can implement
 */
const ALL_CAPABILITIES = [
  {
    value: 'lookupUser',
    name: 'lookupUser - Find user by email',
    checked: true,
  },
  {
    value: 'getPurchases',
    name: 'getPurchases - Fetch purchase history',
    checked: true,
  },
  {
    value: 'revokeAccess',
    name: 'revokeAccess - Revoke access after refund',
    checked: true,
  },
  {
    value: 'transferPurchase',
    name: 'transferPurchase - Transfer license to new owner',
    checked: true,
  },
  {
    value: 'generateMagicLink',
    name: 'generateMagicLink - Send login links',
    checked: true,
  },
  {
    value: 'getSubscriptions',
    name: 'getSubscriptions - Fetch subscriptions (optional)',
    checked: false,
  },
  {
    value: 'updateEmail',
    name: 'updateEmail - Change user email (optional)',
    checked: false,
  },
  {
    value: 'updateName',
    name: 'updateName - Change user name (optional)',
    checked: false,
  },
  {
    value: 'getClaimedSeats',
    name: 'getClaimedSeats - Team seat management (optional)',
    checked: false,
  },
] as const

export interface WizardOptions {
  json?: boolean
}

export interface WizardResult {
  success: boolean
  app?: {
    id: string
    slug: string
    name: string
    frontInboxId: string
    integrationBaseUrl: string
    webhookSecret: string
    capabilities: string[]
    stripeAccountId?: string
    escalationSlackChannel?: string
    autoApproveRefundDays: number
    autoApproveTransferDays: number
  }
  error?: string
}

/**
 * Convert name to URL-friendly slug
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Interactive wizard for setting up a new property (app)
 */
export async function wizard(
  ctx: CommandContext,
  options: WizardOptions = {}
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  if (!ctx.stdin.isTTY && !outputJson) {
    const cliError = new CLIError({
      userMessage:
        'Wizard requires an interactive terminal. Use --json for non-interactive mode.',
      suggestion: 'Re-run in a TTY or pass --json.',
    })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
    return
  }

  try {
    if (!outputJson) {
      ctx.output.data('\n🧙 Property Setup Wizard\n')
      ctx.output.data(
        'This will walk you through setting up a new app in the support platform.\n'
      )
    }

    // Basic info
    const name = await input({
      message: 'App name (e.g., "Total TypeScript"):',
      validate: (v) => v.trim().length > 0 || 'Name is required',
    })

    const suggestedSlug = slugify(name)
    const slug = await input({
      message: 'URL slug:',
      default: suggestedSlug,
      validate: (v) =>
        /^[a-z0-9-]+$/.test(v) ||
        'Slug must be lowercase alphanumeric with dashes',
    })

    // Front inbox
    const frontInboxId = await input({
      message: 'Front inbox ID (e.g., "inb_abc123"):',
      validate: (v) =>
        v.startsWith('inb_') ||
        'Must be a valid Front inbox ID (starts with inb_)',
    })

    // Integration URL
    const integrationBaseUrl = await input({
      message: 'Integration base URL (where SDK endpoints live):',
      default: `https://${slug}.com`,
      validate: (v) => {
        try {
          new URL(v)
          return true
        } catch {
          return 'Must be a valid URL'
        }
      },
    })

    // Capabilities
    const capabilities = await checkbox({
      message: 'Select capabilities to implement:',
      choices: ALL_CAPABILITIES.map((c) => ({
        value: c.value,
        name: c.name,
        checked: c.checked,
      })),
    })

    // Stripe Connect (optional)
    const useStripe = await confirm({
      message: 'Enable Stripe Connect for refund processing?',
      default: true,
    })

    let stripeAccountId: string | undefined
    if (useStripe) {
      stripeAccountId =
        (await input({
          message:
            'Stripe Connect account ID (e.g., "acct_xxx") or leave blank to connect later:',
          default: '',
        })) || undefined
    }

    // Escalation channel (optional)
    const useSlackEscalation = await confirm({
      message: 'Configure Slack escalation channel?',
      default: false,
    })

    let escalationSlackChannel: string | undefined
    if (useSlackEscalation) {
      escalationSlackChannel = await input({
        message: 'Slack channel ID for escalations (e.g., "C0123456789"):',
        validate: (v) =>
          v.startsWith('C') || 'Must be a valid Slack channel ID',
      })
    }

    // Auto-approval settings
    const configureAutoApproval = await confirm({
      message:
        'Configure auto-approval thresholds? (default: 30 days refund, 14 days transfer)',
      default: false,
    })

    let autoApproveRefundDays = 30
    let autoApproveTransferDays = 14

    if (configureAutoApproval) {
      const refundDaysStr = await input({
        message: 'Auto-approve refunds within X days of purchase:',
        default: '30',
        validate: (v) =>
          (!isNaN(parseInt(v)) && parseInt(v) >= 0) ||
          'Must be a non-negative number',
      })
      autoApproveRefundDays = parseInt(refundDaysStr)

      const transferDaysStr = await input({
        message: 'Auto-approve transfers within X days of purchase:',
        default: '14',
        validate: (v) =>
          (!isNaN(parseInt(v)) && parseInt(v) >= 0) ||
          'Must be a non-negative number',
      })
      autoApproveTransferDays = parseInt(transferDaysStr)
    }

    // Generate secrets
    const id = `app_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const webhookSecret = randomBytes(32).toString('hex')

    const result: WizardResult = {
      success: true,
      app: {
        id,
        slug,
        name,
        frontInboxId,
        integrationBaseUrl,
        webhookSecret,
        capabilities,
        stripeAccountId,
        escalationSlackChannel,
        autoApproveRefundDays,
        autoApproveTransferDays,
      },
    }

    if (outputJson) {
      ctx.output.data(result)
      return
    }

    ctx.output.data('\n' + '='.repeat(60))
    ctx.output.data('✅ Configuration complete!\n')

    ctx.output.data('📋 App Details:')
    ctx.output.data(`   ID:   ${id}`)
    ctx.output.data(`   Slug: ${slug}`)
    ctx.output.data(`   Name: ${name}`)
    ctx.output.data(`   URL:  ${integrationBaseUrl}`)

    ctx.output.data('\n🔗 Front Integration:')
    ctx.output.data(`   Inbox ID: ${frontInboxId}`)

    if (stripeAccountId) {
      ctx.output.data('\n💳 Stripe Connect:')
      ctx.output.data(`   Account ID: ${stripeAccountId}`)
    }

    ctx.output.data('\n🔧 Capabilities:')
    capabilities.forEach((c) => ctx.output.data(`   - ${c}`))

    ctx.output.data('\n⏱️  Auto-Approval:')
    ctx.output.data(`   Refunds:   within ${autoApproveRefundDays} days`)
    ctx.output.data(`   Transfers: within ${autoApproveTransferDays} days`)

    ctx.output.data('\n' + '='.repeat(60))
    ctx.output.data('\n📝 Next Steps:\n')

    ctx.output.data("1. Add to your app's .env:")
    ctx.output.data('   ```')
    ctx.output.data(`   SUPPORT_WEBHOOK_SECRET=${webhookSecret}`)
    ctx.output.data('   ```\n')

    ctx.output.data('2. Implement the SDK handler in your app:')
    ctx.output.data('   ```typescript')
    ctx.output.data('   // app/api/support/[...action]/route.ts')
    ctx.output.data(
      "   import { createSupportHandler } from '@skillrecordings/sdk/handler'"
    )
    ctx.output.data("   import { integration } from './integration'")
    ctx.output.data('')
    ctx.output.data('   const handler = createSupportHandler({')
    ctx.output.data('     integration,')
    ctx.output.data(`     secret: process.env.SUPPORT_WEBHOOK_SECRET!,`)
    ctx.output.data('   })')
    ctx.output.data('')
    ctx.output.data('   export { handler as POST }')
    ctx.output.data('   ```\n')

    ctx.output.data('3. Insert into database:')
    ctx.output.data('   ```sql')
    ctx.output.data(
      `   INSERT INTO SUPPORT_apps (id, slug, name, front_inbox_id, integration_base_url, webhook_secret, capabilities, auto_approve_refund_days, auto_approve_transfer_days)`
    )
    ctx.output.data(
      `   VALUES ('${id}', '${slug}', '${name}', '${frontInboxId}', '${integrationBaseUrl}', '${webhookSecret}', '${JSON.stringify(capabilities)}', ${autoApproveRefundDays}, ${autoApproveTransferDays});`
    )
    ctx.output.data('   ```\n')

    if (!stripeAccountId && useStripe) {
      ctx.output.data('4. Connect Stripe account:')
      ctx.output.data(
        '   Visit https://skill-support-agent-web.vercel.app/api/stripe/connect/authorize?appSlug=' +
          slug
      )
      ctx.output.data('')
    }

    ctx.output.data(
      '📖 See docs/support-app-prd/67-sdk.md for full integration guide.\n'
    )
  } catch (error) {
    if ((error as Error).name === 'ExitPromptError') {
      // User cancelled
      ctx.output.warn('Wizard cancelled.')
      process.exitCode = 1
      return
    }
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Wizard failed.',
            suggestion: 'Re-run the wizard and check your inputs.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}
