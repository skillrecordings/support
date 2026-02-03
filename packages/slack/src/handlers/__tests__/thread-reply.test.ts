import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import * as axiomModule from '../../../../core/src/observability/axiom'
import * as slackClientModule from '../../../../core/src/slack/client'
import { createDraftStore, registerDraftForThread } from '../../intents/draft'

type HandleThreadReply = typeof import('../thread-reply').handleThreadReply
let handleThreadReply: HandleThreadReply

const postMessage = vi
  .fn()
  .mockResolvedValue({ ok: true, ts: '1', channel: 'C123' })

const originalToken = process.env.SLACK_BOT_TOKEN

describe('handleThreadReply', () => {
  beforeAll(async () => {
    ;({ handleThreadReply } = await import('../thread-reply'))
  })

  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
    postMessage.mockClear()
    vi.spyOn(slackClientModule, 'getSlackClient').mockReturnValue({
      chat: { postMessage },
    } as ReturnType<typeof slackClientModule.getSlackClient>)
    vi.spyOn(axiomModule, 'initializeAxiom').mockImplementation(() => {})
    vi.spyOn(axiomModule, 'log').mockResolvedValue(undefined)
  })

  it('posts a revised draft in the thread', async () => {
    const draftStore = createDraftStore()
    registerDraftForThread('1700000000.000100', 'Original draft', {
      draftStore,
    })

    const generateText = vi.fn().mockResolvedValue({
      text: 'Revised draft',
    })

    const result = await handleThreadReply(
      {
        event_id: 'evt-123',
        event: {
          type: 'message',
          user: 'U123',
          channel: 'C123',
          text: 'simplify this',
          ts: '1700000000.000200',
          thread_ts: '1700000000.000100',
        },
      },
      { draftStore, generateText }
    )

    expect(result.handled).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: expect.stringContaining('Updated draft v1'),
      thread_ts: '1700000000.000100',
    })
  })

  it('sends approval confirmation when requested', async () => {
    const draftStore = createDraftStore()
    registerDraftForThread('1700000000.000300', 'Draft to approve', {
      draftStore,
    })

    const result = await handleThreadReply(
      {
        event: {
          type: 'message',
          user: 'U234',
          channel: 'C123',
          text: 'looks good',
          ts: '1700000000.000400',
          thread_ts: '1700000000.000300',
        },
      },
      { draftStore }
    )

    expect(result.handled).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: expect.stringContaining('Approved'),
      thread_ts: '1700000000.000300',
    })
  })

  it('ignores non-refinement replies gracefully', async () => {
    const draftStore = createDraftStore()
    registerDraftForThread('1700000000.000500', 'Draft for thread', {
      draftStore,
    })

    const result = await handleThreadReply(
      {
        event: {
          type: 'message',
          user: 'U456',
          channel: 'C123',
          text: 'thanks!',
          ts: '1700000000.000600',
          thread_ts: '1700000000.000500',
        },
      },
      { draftStore }
    )

    // Non-refinement intents now fall back to general intent routing
    expect(result.handled).toBe(true)
    expect(postMessage).toHaveBeenCalled()
  })
})

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.SLACK_BOT_TOKEN
  } else {
    process.env.SLACK_BOT_TOKEN = originalToken
  }
})
