import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * User lookup result with purchase and subscription data.
 */
export interface UserLookupResult {
  /**
   * User identifier
   */
  id: string
  /**
   * User email address
   */
  email: string
  /**
   * User display name if available
   */
  name?: string
  /**
   * Purchase history
   */
  purchases: Array<{
    id: string
    productId: string
    productName: string
    purchasedAt: string
    status: 'active' | 'refunded' | 'cancelled'
    amount: number
    currency: string
  }>
  /**
   * Active subscriptions
   */
  subscriptions: Array<{
    id: string
    productId: string
    productName: string
    status: 'active' | 'cancelled' | 'past_due'
    currentPeriodEnd: string
  }>
}

/**
 * Look up user by email address to find their purchases, subscriptions, and account status.
 *
 * This tool queries the SDK adapter for the specified app to retrieve complete user
 * information including purchase history and subscription status. Use this when the
 * agent needs to understand a customer's account status before taking action.
 *
 * @example
 * ```typescript
 * const result = await lookupUser.execute(
 *   { email: 'user@example.com', appId: 'total-typescript' },
 *   context
 * )
 * ```
 */
export const lookupUser = createTool({
  name: 'lookup_user',
  description:
    'Look up user by email address to find their purchases, subscriptions, and account status',
  parameters: z.object({
    /**
     * Email address to look up
     */
    email: z.string().email('Must be a valid email address'),
    /**
     * Application identifier (e.g., 'total-typescript', 'pro-tailwind')
     */
    appId: z.string().min(1, 'App ID is required'),
  }),
  execute: async ({ email, appId }, context) => {
    // TODO: Integrate with SDK adapter interface
    // const app = await appRegistry.get(appId)
    // return app.integration.lookupUser(email)

    // Stub implementation - returns mock data for type safety
    const result: UserLookupResult = {
      id: 'stub-user-id',
      email,
      name: 'Stub User',
      purchases: [],
      subscriptions: [],
    }

    return result
  },
})
