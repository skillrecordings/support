import { randomBytes, randomUUID } from 'node:crypto'
import { checkbox, confirm, input, select } from '@inquirer/prompts'

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
export async function wizard(options: WizardOptions = {}): Promise<void> {
  const { json = false } = options

  if (!process.stdin.isTTY && !json) {
    console.error(
      'Error: Wizard requires an interactive terminal. Use --json for non-interactive mode.'
    )
    process.exit(1)
  }

  try {
    console.log('\n🧙 Property Setup Wizard\n')
    console.log(
      'This will walk you through setting up a new app in the support platform.\n'
    )

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

    if (json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log('\n' + '='.repeat(60))
      console.log('✅ Configuration complete!\n')

      console.log('📋 App Details:')
      console.log(`   ID:   ${id}`)
      console.log(`   Slug: ${slug}`)
      console.log(`   Name: ${name}`)
      console.log(`   URL:  ${integrationBaseUrl}`)

      console.log('\n🔗 Front Integration:')
      console.log(`   Inbox ID: ${frontInboxId}`)

      if (stripeAccountId) {
        console.log('\n💳 Stripe Connect:')
        console.log(`   Account ID: ${stripeAccountId}`)
      }

      console.log('\n🔧 Capabilities:')
      capabilities.forEach((c) => console.log(`   - ${c}`))

      console.log('\n⏱️  Auto-Approval:')
      console.log(`   Refunds:   within ${autoApproveRefundDays} days`)
      console.log(`   Transfers: within ${autoApproveTransferDays} days`)

      console.log('\n' + '='.repeat(60))
      console.log('\n📝 Next Steps:\n')

      console.log("1. Add to your app's .env:")
      console.log('   ```')
      console.log(`   SUPPORT_WEBHOOK_SECRET=${webhookSecret}`)
      console.log('   ```\n')

      console.log('2. Implement the SDK handler in your app:')
      console.log('   ```typescript')
      console.log('   // app/api/support/[...action]/route.ts')
      console.log(
        "   import { createSupportHandler } from '@skillrecordings/sdk/handler'"
      )
      console.log("   import { integration } from './integration'")
      console.log('')
      console.log('   const handler = createSupportHandler({')
      console.log('     integration,')
      console.log(`     secret: process.env.SUPPORT_WEBHOOK_SECRET!,`)
      console.log('   })')
      console.log('')
      console.log('   export { handler as POST }')
      console.log('   ```\n')

      console.log('3. Insert into database:')
      console.log('   ```sql')
      console.log(
        `   INSERT INTO SUPPORT_apps (id, slug, name, front_inbox_id, integration_base_url, webhook_secret, capabilities, auto_approve_refund_days, auto_approve_transfer_days)`
      )
      console.log(
        `   VALUES ('${id}', '${slug}', '${name}', '${frontInboxId}', '${integrationBaseUrl}', '${webhookSecret}', '${JSON.stringify(capabilities)}', ${autoApproveRefundDays}, ${autoApproveTransferDays});`
      )
      console.log('   ```\n')

      if (!stripeAccountId && useStripe) {
        console.log('4. Connect Stripe account:')
        console.log(
          '   Visit https://skill-support-agent-web.vercel.app/api/stripe/connect/authorize?appSlug=' +
            slug
        )
        console.log('')
      }

      console.log(
        '📖 See docs/support-app-prd/67-sdk.md for full integration guide.\n'
      )
    }

    process.exit(0)
  } catch (error) {
    if ((error as Error).name === 'ExitPromptError') {
      // User cancelled
      console.log('\n\nWizard cancelled.')
      process.exit(1)
    }
    throw error
  }
}
