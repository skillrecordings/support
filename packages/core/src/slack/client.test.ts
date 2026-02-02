import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSlackClient,
  postApprovalMessage,
  resetSlackClient,
  updateApprovalMessage,
} from './client'

// Store original env
const originalEnv = process.env.SLACK_BOT_TOKEN

// Mock @slack/web-api
const mockPostMessage = vi.fn().mockResolvedValue({
  ok: true,
  ts: '1706745600.123456',
  channel: 'C1234567890',
})

const mockUpdate = vi.fn().mockResolvedValue({
  ok: true,
  ts: '1706745600.123456',
  channel: 'C1234567890',
})

vi.mock('@slack/web-api', () => {
  return {
    WebClient: vi.fn().mockImplementation(() => ({
      chat: {
        postMessage: mockPostMessage,
        update: mockUpdate,
      },
    })),
  }
})

describe('getSlackClient', () => {
  beforeEach(() => {
    resetSlackClient()
    mockPostMessage.mockClear()
    mockUpdate.mockClear()
  })

  afterEach(() => {
    // Restore original env
    if (originalEnv) {
      process.env.SLACK_BOT_TOKEN = originalEnv
    } else {
      delete process.env.SLACK_BOT_TOKEN
    }
    resetSlackClient()
  })

  it('should throw if SLACK_BOT_TOKEN is not set', () => {
    delete process.env.SLACK_BOT_TOKEN
    expect(() => getSlackClient()).toThrow('SLACK_BOT_TOKEN not set')
  })

  it('should create WebClient with token from env', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
    const client = getSlackClient()
    expect(client).toBeDefined()
    expect(client.chat).toBeDefined()
  })

  it('should return same instance on subsequent calls (singleton)', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
    const client1 = getSlackClient()
    const client2 = getSlackClient()
    expect(client1).toBe(client2)
  })
})

describe('postApprovalMessage', () => {
  beforeEach(() => {
    resetSlackClient()
    mockPostMessage.mockClear()
    mockUpdate.mockClear()
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
  })

  afterEach(() => {
    if (originalEnv) {
      process.env.SLACK_BOT_TOKEN = originalEnv
    } else {
      delete process.env.SLACK_BOT_TOKEN
    }
    resetSlackClient()
  })

  it('should post message to channel with blocks', async () => {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Approval request',
        },
      },
    ]

    const result = await postApprovalMessage(
      'C1234567890',
      blocks,
      'Approval request'
    )

    expect(result).toEqual({
      ts: '1706745600.123456',
      channel: 'C1234567890',
    })

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'C1234567890',
      blocks,
      text: 'Approval request',
    })
  })
})

describe('updateApprovalMessage', () => {
  beforeEach(() => {
    resetSlackClient()
    mockPostMessage.mockClear()
    mockUpdate.mockClear()
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
  })

  afterEach(() => {
    if (originalEnv) {
      process.env.SLACK_BOT_TOKEN = originalEnv
    } else {
      delete process.env.SLACK_BOT_TOKEN
    }
    resetSlackClient()
  })

  it('should update existing message with new blocks', async () => {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Updated approval status',
        },
      },
    ]

    await updateApprovalMessage(
      'C1234567890',
      '1706745600.123456',
      blocks,
      'Updated'
    )

    expect(mockUpdate).toHaveBeenCalledWith({
      channel: 'C1234567890',
      ts: '1706745600.123456',
      blocks,
      text: 'Updated',
    })
  })
})
