// Set environment variables BEFORE any imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { App } from '@skillrecordings/database'

// Mock the database module before imports
vi.mock('@skillrecordings/database', () => {
	const mockFn = vi.fn()
	return {
		database: {
			query: {
				AppsTable: {
					findFirst: mockFn,
				},
			},
		},
		eq: vi.fn((_col: any, _val: any) => ({ sql: 'mocked', params: [] })),
		AppsTable: {
			slug: 'slug',
			id: 'id',
		},
	}
})

import { getApp, getAppById, clearCache } from '../app-registry'
import { database } from '@skillrecordings/database'

const mockApp: App = {
	id: 'app-123',
	slug: 'test-app',
	name: 'Test App',
	front_inbox_id: 'inbox-123',
	stripe_account_id: null,
	stripe_connected: false,
	integration_base_url: 'https://test.example.com',
	webhook_secret: 'secret-123',
	capabilities: ['refund', 'transfer'],
	auto_approve_refund_days: 30,
	auto_approve_transfer_days: 14,
	escalation_slack_channel: null,
	created_at: new Date('2024-01-01'),
	updated_at: new Date('2024-01-01'),
}

describe('app-registry', () => {
	let mockFindFirst: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockFindFirst = database.query.AppsTable.findFirst as ReturnType<typeof vi.fn>
		mockFindFirst.mockReset()
		clearCache()
	})

	afterEach(() => {
		vi.clearAllTimers()
	})

	describe('getApp', () => {
		it('returns null for unknown slug', async () => {
			mockFindFirst.mockResolvedValue(undefined)
			const result = await getApp('unknown')
			expect(result).toBeNull()
		})

		it('returns app from database', async () => {
			mockFindFirst.mockResolvedValue(mockApp)
			const result = await getApp('test-app')
			expect(result).toEqual(mockApp)
			expect(mockFindFirst).toHaveBeenCalledTimes(1)
		})

		it('uses cache on second call', async () => {
			mockFindFirst.mockResolvedValue(mockApp)

			const first = await getApp('test-app')
			const second = await getApp('test-app')

			expect(first).toEqual(mockApp)
			expect(second).toEqual(mockApp)
			expect(mockFindFirst).toHaveBeenCalledTimes(1)
		})

		it('cache expires after TTL', async () => {
			vi.useFakeTimers()
			mockFindFirst.mockResolvedValue(mockApp)

			await getApp('test-app')
			expect(mockFindFirst).toHaveBeenCalledTimes(1)

			// Advance time past TTL (5 minutes + 1ms)
			vi.advanceTimersByTime(5 * 60 * 1000 + 1)

			await getApp('test-app')
			expect(mockFindFirst).toHaveBeenCalledTimes(2)

			vi.useRealTimers()
		})
	})

	describe('getAppById', () => {
		it('returns null for unknown id', async () => {
			mockFindFirst.mockResolvedValue(undefined)
			const result = await getAppById('unknown')
			expect(result).toBeNull()
		})

		it('returns app from database', async () => {
			mockFindFirst.mockResolvedValue(mockApp)
			const result = await getAppById('app-123')
			expect(result).toEqual(mockApp)
			expect(mockFindFirst).toHaveBeenCalledTimes(1)
		})

		it('uses cache from slug-based lookup', async () => {
			mockFindFirst.mockResolvedValue(mockApp)

			// First call via slug
			await getApp('test-app')
			expect(mockFindFirst).toHaveBeenCalledTimes(1)

			// Second call via id should use cache
			const result = await getAppById('app-123')
			expect(result).toEqual(mockApp)
			expect(mockFindFirst).toHaveBeenCalledTimes(1)
		})

		it('cache expires after TTL', async () => {
			vi.useFakeTimers()
			mockFindFirst.mockResolvedValue(mockApp)

			await getAppById('app-123')
			expect(mockFindFirst).toHaveBeenCalledTimes(1)

			// Advance time past TTL (5 minutes + 1ms)
			vi.advanceTimersByTime(5 * 60 * 1000 + 1)

			await getAppById('app-123')
			expect(mockFindFirst).toHaveBeenCalledTimes(2)

			vi.useRealTimers()
		})
	})

	describe('clearCache', () => {
		it('removes all entries', async () => {
			mockFindFirst.mockResolvedValue(mockApp)

			await getApp('test-app')
			expect(mockFindFirst).toHaveBeenCalledTimes(1)

			clearCache()

			await getApp('test-app')
			expect(mockFindFirst).toHaveBeenCalledTimes(2)
		})
	})
})
