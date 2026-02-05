import { describe, expect, it } from 'vitest'
import { tools } from '../../../src/mcp/tools'

type JsonSchema = Record<string, unknown>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidJsonSchema = (schema: unknown): boolean => {
  if (!isPlainObject(schema)) return false
  const typeValue = schema.type
  if (typeof typeValue !== 'string') return false

  if (typeValue === 'object') {
    const properties = schema.properties
    if (properties !== undefined && !isPlainObject(properties)) return false
    if (Array.isArray(schema.required)) {
      if (!schema.required.every((item) => typeof item === 'string')) {
        return false
      }
    }
    if (properties) {
      for (const value of Object.values(properties)) {
        if (!isValidJsonSchema(value)) return false
      }
    }
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum)) return false
  }

  if (schema.items !== undefined) {
    if (!isValidJsonSchema(schema.items)) return false
  }

  return true
}

const expectedToolNames = [
  'front_inbox_list',
  'front_inbox_conversations',
  'front_conversation_get',
  'front_assign',
  'front_reply',
  'front_archive',
  'front_tag',
  'front_search',
  'front_api',
]

describe('mcp tool registry', () => {
  it('includes expected tool definitions', () => {
    const names = tools.map((tool) => tool.name)

    for (const expected of expectedToolNames) {
      expect(names).toContain(expected)
    }
    expect(names.length).toBeGreaterThanOrEqual(expectedToolNames.length)
  })

  it('defines JSON schema input for each tool', () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(isValidJsonSchema(tool.inputSchema as JsonSchema)).toBe(true)
    }
  })
})
