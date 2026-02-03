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
import { HELP_RESPONSE } from '../../intents/router'

type HandleAppMention = typeof import('../mention').handleAppMention
let handleAppMention: HandleAppMention

const postMessage = vi
  .fn()
  .mockResolvedValue({ ok: true, ts: '1', channel: 'C123' })

const originalToken = process.env.SLACK_BOT_TOKEN

describe('handleAppMention', () => {
  beforeAll(async () => {
    ;({ handleAppMention } = await import('../mention'))
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

  it('posts a response in the thread for status queries', async () => {
    await handleAppMention({
      event_id: 'evt-123',
      event: {
        type: 'app_mention',
        user: 'U123',
        channel: 'C123',
        text: '<@U999> anything urgent?',
        ts: '1700000000.000100',
      },
    })

    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: expect.stringContaining('status'),
      thread_ts: '1700000000.000100',
    })
  })

  it('uses thread_ts when provided', async () => {
    await handleAppMention({
      event: {
        type: 'app_mention',
        user: 'U123',
        channel: 'C123',
        text: '<@U999> approve and send',
        ts: '1700000000.000200',
        thread_ts: '1699999999.999900',
      },
    })

    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: expect.any(String),
      thread_ts: '1699999999.999900',
    })
  })

  it('returns help response for empty mentions', async () => {
    const result = await handleAppMention({
      event: {
        type: 'app_mention',
        user: 'U123',
        channel: 'C123',
        text: '<@U999>   ',
        ts: '1700000000.000300',
      },
    })

    expect(result.responseText).toBe(HELP_RESPONSE)
  })
})

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.SLACK_BOT_TOKEN
  } else {
    process.env.SLACK_BOT_TOKEN = originalToken
  }
})
