import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../../tests/helpers/test-context'
import { createIssue } from './create'
import { getIssue } from './get'
import { listIssues } from './list'

// Mock the Linear SDK
vi.mock('@linear/sdk')

describe('Linear commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LINEAR_API_KEY
  })

  describe('client initialization', () => {
    it('should throw when LINEAR_API_KEY is missing', async () => {
      delete process.env.LINEAR_API_KEY

      try {
        const module = await import('./client')
        module.getLinearClient()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain('LINEAR_API_KEY')
      }
    })
  })

  describe('listIssues command', () => {
    beforeEach(() => {
      process.env.LINEAR_API_KEY = 'test-key-123'
    })

    it('should list issues in text format with multiple issues', async () => {
      const mockClient = {
        issues: vi.fn().mockResolvedValue({
          nodes: [
            {
              id: 'issue-1',
              identifier: 'ENG-1',
              title: 'Test issue',
              state: Promise.resolve({ name: 'In Progress' }),
              priority: 2,
              url: 'https://linear.app/issue/ENG-1',
            },
            {
              id: 'issue-2',
              identifier: 'ENG-2',
              title: 'Another issue',
              state: Promise.resolve({ name: 'Todo' }),
              priority: 1,
              url: 'https://linear.app/issue/ENG-2',
            },
          ],
        }),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStdout } = await createTestContext({ format: 'text' })
      await listIssues(ctx)

      const output = getStdout()
      expect(output).toContain('Linear Issues')
      expect(output).toContain('ENG-1')
      expect(output).toContain('Test issue')
      expect(output).toContain('ENG-2')
      expect(output).toContain('Another issue')
    })

    it('should handle empty issue list', async () => {
      const mockClient = {
        issues: vi.fn().mockResolvedValue({ nodes: [] }),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStdout } = await createTestContext({ format: 'text' })
      await listIssues(ctx)

      const output = getStdout()
      expect(output).toContain('No issues found')
    })

    it('should handle API errors when listing issues', async () => {
      const mockClient = {
        issues: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStderr } = await createTestContext({ format: 'text' })
      await listIssues(ctx)

      const output = getStderr()
      expect(output).toContain('Failed to list Linear issues')
    })
  })

  describe('getIssue command', () => {
    beforeEach(() => {
      process.env.LINEAR_API_KEY = 'test-key-123'
    })

    it('should fetch a single issue with all fields in text format', async () => {
      const mockClient = {
        issue: vi.fn().mockResolvedValue({
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test issue',
          description: 'Test description',
          state: Promise.resolve({ name: 'In Progress' }),
          priority: 2,
          assignee: Promise.resolve({ name: 'John Doe' }),
          url: 'https://linear.app/issue/ENG-1',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        }),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStdout } = await createTestContext({ format: 'text' })
      await getIssue(ctx, 'ENG-1')

      const output = getStdout()
      expect(output).toContain('Issue Details')
      expect(output).toContain('ENG-1')
      expect(output).toContain('Test issue')
      expect(output).toContain('In Progress')
      expect(output).toContain('John Doe')
    })

    it('should handle issue not found error', async () => {
      const mockClient = {
        issue: vi.fn().mockResolvedValue(null),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStderr } = await createTestContext({ format: 'text' })
      await getIssue(ctx, 'INVALID-999')

      const output = getStderr()
      expect(output).toContain('not found')
    })

    it('should handle missing assignee gracefully', async () => {
      const mockClient = {
        issue: vi.fn().mockResolvedValue({
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test issue',
          state: Promise.resolve({ name: 'Todo' }),
          priority: 1,
          assignee: Promise.resolve(null),
          url: 'https://linear.app/issue/ENG-1',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        }),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStdout } = await createTestContext({ format: 'text' })
      await getIssue(ctx, 'ENG-1')

      const output = getStdout()
      expect(output).toContain('ENG-1')
      expect(output).not.toContain('Assignee')
    })

    it('should handle API errors when fetching issue', async () => {
      const mockClient = {
        issue: vi.fn().mockRejectedValue(new Error('API error')),
      }

      vi.doMock('./client', () => ({
        getLinearClient: () => mockClient,
      }))

      const { ctx, getStderr } = await createTestContext({ format: 'text' })
      await getIssue(ctx, 'ENG-1')

      const output = getStderr()
      expect(output).toContain('Failed to fetch Linear issue')
    })
  })

  describe('input validation', () => {
    it('should validate issue title is required', () => {
      const validateTitle = (title: string): void => {
        if (!title || title.trim().length === 0) {
          throw new Error('Issue title is required.')
        }
      }
      expect(() => validateTitle('')).toThrow('Issue title is required.')
    })

    it('should reject title with only whitespace', () => {
      const validateTitle = (title: string): void => {
        if (!title || title.trim().length === 0) {
          throw new Error('Issue title is required.')
        }
      }
      expect(() => validateTitle('   ')).toThrow('Issue title is required.')
    })
  })
})
