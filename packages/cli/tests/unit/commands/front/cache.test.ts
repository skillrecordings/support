import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CACHE_CONFIG,
  FrontResponseCache,
  classifyUrl,
} from '../../../../src/commands/front/cache'
import { extractResourcePath } from '../../../../src/commands/front/client'

const createCache = (overrides = {}) =>
  new FrontResponseCache({ ...DEFAULT_CACHE_CONFIG, ...overrides })

describe('FrontResponseCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns cached data on hit', () => {
    const cache = createCache()
    cache.set('/conversations', { ok: true })

    expect(cache.get('/conversations')).toEqual({ ok: true })
  })

  it('returns undefined on miss', () => {
    const cache = createCache()

    expect(cache.get('/conversations')).toBeUndefined()
  })

  it('expires hot tier entries after TTL', () => {
    vi.useFakeTimers()
    const cache = createCache({ hotTtlMs: 10 })
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    cache.set('/conversations', { ok: true })

    vi.advanceTimersByTime(11)

    expect(cache.get('/conversations')).toBeUndefined()
  })

  it('does not expire static tier entries', () => {
    vi.useFakeTimers()
    const cache = createCache()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    cache.set('/inboxes', { ok: true })

    vi.advanceTimersByTime(1000 * 60 * 60 * 24)

    expect(cache.get('/inboxes')).toEqual({ ok: true })
  })

  it('expires warm tier entries after TTL', () => {
    vi.useFakeTimers()
    const cache = createCache({ warmTtlMs: 10 })
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    cache.set('/tags', { ok: true })

    vi.advanceTimersByTime(11)

    expect(cache.get('/tags')).toBeUndefined()
  })

  it('invalidates by URL pattern on mutation', () => {
    const cache = createCache()
    cache.set('/conversations/cnv_1', { ok: true })
    cache.set('/conversations/cnv_1/messages', { ok: true })
    cache.set('/tags', { ok: true })

    cache.invalidate('/conversations/cnv_1')

    expect(cache.get('/conversations/cnv_1')).toBeUndefined()
    expect(cache.get('/conversations/cnv_1/messages')).toBeUndefined()
    expect(cache.get('/tags')).toEqual({ ok: true })
  })

  it('invalidateTier clears only matching tier', () => {
    const cache = createCache()
    cache.set('/inboxes', { ok: true })
    cache.set('/tags', { ok: true })
    cache.set('/conversations', { ok: true })

    cache.invalidateTier('warm')

    expect(cache.get('/inboxes')).toEqual({ ok: true })
    expect(cache.get('/tags')).toBeUndefined()
    expect(cache.get('/conversations')).toEqual({ ok: true })
  })

  it('clear removes all entries', () => {
    const cache = createCache()
    cache.set('/inboxes', { ok: true })
    cache.set('/tags', { ok: true })

    cache.clear()

    expect(cache.get('/inboxes')).toBeUndefined()
    expect(cache.get('/tags')).toBeUndefined()
  })

  it('stats returns correct counts per tier', () => {
    const cache = createCache()
    cache.set('/inboxes', { ok: true })
    cache.set('/tags', { ok: true })
    cache.set('/conversations', { ok: true })

    expect(cache.stats()).toEqual({
      size: 3,
      tiers: { static: 1, warm: 1, hot: 1 },
    })
  })

  it('classifyUrl maps /inboxes to static', () => {
    expect(classifyUrl('/inboxes')).toBe('static')
  })

  it('classifyUrl maps /tags to warm', () => {
    expect(classifyUrl('/tags')).toBe('warm')
  })

  it('classifyUrl maps /conversations to hot', () => {
    expect(classifyUrl('/conversations')).toBe('hot')
  })

  it('classifyUrl maps /inboxes/xxx/conversations to hot (not static)', () => {
    expect(classifyUrl('/inboxes/inb_1/conversations')).toBe('hot')
  })

  it('disabled cache always returns undefined', () => {
    const cache = createCache({ enabled: false })
    cache.set('/tags', { ok: true })

    expect(cache.get('/tags')).toBeUndefined()
  })
})

describe('extractResourcePath', () => {
  it('extracts /conversations/cnv_xxx from /conversations/cnv_xxx/tags', () => {
    expect(extractResourcePath('/conversations/cnv_1/tags')).toBe(
      '/conversations/cnv_1'
    )
  })

  it('extracts /tags from /tags', () => {
    expect(extractResourcePath('/tags')).toBe('/tags')
  })

  it('handles full URLs', () => {
    expect(extractResourcePath('https://api.frontapp.com/tags/tag_1')).toBe(
      '/tags/tag_1'
    )
  })
})
