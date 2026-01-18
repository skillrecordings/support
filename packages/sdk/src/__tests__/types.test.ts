import { describe, it, expectTypeOf } from 'vitest';
import type {
  SupportIntegration,
  User,
  Purchase,
  Subscription,
  ActionResult,
  ClaimedSeat,
} from '../integration';

describe('SDK Types', () => {
  it('SupportIntegration has required methods', () => {
    const integration: SupportIntegration = {
      lookupUser: async (email: string) => null as User | null,
      getPurchases: async (userId: string) => [] as Purchase[],
      revokeAccess: async (params) => ({ success: true }),
      transferPurchase: async (params) => ({ success: true }),
      generateMagicLink: async (params) => ({ url: '' }),
    };

    expectTypeOf(integration.lookupUser).toBeFunction();
    expectTypeOf(integration.getPurchases).toBeFunction();
    expectTypeOf(integration.revokeAccess).toBeFunction();
    expectTypeOf(integration.transferPurchase).toBeFunction();
    expectTypeOf(integration.generateMagicLink).toBeFunction();
  });

  it('SupportIntegration has optional methods', () => {
    const integration: SupportIntegration = {
      lookupUser: async (email: string) => null as User | null,
      getPurchases: async (userId: string) => [] as Purchase[],
      revokeAccess: async (params) => ({ success: true }),
      transferPurchase: async (params) => ({ success: true }),
      generateMagicLink: async (params) => ({ url: '' }),
      // Optional methods
      getSubscriptions: async (userId: string) => [] as Subscription[],
      updateEmail: async (params) => ({ success: true }),
      updateName: async (params) => ({ success: true }),
      getClaimedSeats: async (bulkCouponId: string) => [] as ClaimedSeat[],
    };

    if (integration.getSubscriptions) {
      expectTypeOf(integration.getSubscriptions).toBeFunction();
    }
    if (integration.updateEmail) {
      expectTypeOf(integration.updateEmail).toBeFunction();
    }
    if (integration.updateName) {
      expectTypeOf(integration.updateName).toBeFunction();
    }
    if (integration.getClaimedSeats) {
      expectTypeOf(integration.getClaimedSeats).toBeFunction();
    }
  });

  it('User type has required fields', () => {
    const user: User = {
      id: 'usr_123',
      email: '[EMAIL]',
      name: 'Test User',
      createdAt: new Date(),
    };

    expectTypeOf(user).toMatchTypeOf<User>();
  });

  it('Purchase type includes stripeChargeId', () => {
    const purchase: Purchase = {
      id: 'pur_123',
      productId: 'prod_123',
      productName: 'Test Product',
      purchasedAt: new Date(),
      amount: 10000,
      currency: 'usd',
      stripeChargeId: 'ch_123',
      status: 'active',
    };

    expectTypeOf(purchase.stripeChargeId).toMatchTypeOf<string | undefined>();
    expectTypeOf(purchase.status).toMatchTypeOf<
      'active' | 'refunded' | 'transferred'
    >();
  });

  it('ActionResult has success and optional error', () => {
    const success: ActionResult = { success: true };
    const failure: ActionResult = {
      success: false,
      error: 'Something went wrong',
    };

    expectTypeOf(success).toMatchTypeOf<ActionResult>();
    expectTypeOf(failure).toMatchTypeOf<ActionResult>();
  });

  it('Subscription type has all required fields', () => {
    const subscription: Subscription = {
      id: 'sub_123',
      productId: 'prod_123',
      productName: 'Test Subscription',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
    };

    expectTypeOf(subscription.status).toMatchTypeOf<
      'active' | 'cancelled' | 'expired' | 'paused'
    >();
  });

  it('ClaimedSeat has user info and timestamp', () => {
    const seat: ClaimedSeat = {
      userId: 'usr_123',
      email: '[EMAIL]',
      claimedAt: new Date(),
    };

    expectTypeOf(seat).toMatchTypeOf<ClaimedSeat>();
  });
});
