import { describe, expect, it } from 'vitest'
import { KnownTagHighlights, TagHighlightSchema, TagSchema } from './tag'

describe('TagSchema', () => {
  const validTag = {
    _links: {
      self: 'https://api.frontapp.com/tags/tag_123',
      related: {
        conversations: 'https://api.frontapp.com/tags/tag_123/conversations',
        owner: 'https://api.frontapp.com/tags/tag_123/owner',
        children: 'https://api.frontapp.com/tags/tag_123/children',
      },
    },
    id: 'tag_123',
    name: 'Test Tag',
    description: 'A test tag',
    highlight: 'blue',
    is_private: false,
    is_visible_in_conversation_lists: true,
    created_at: 1700000000,
    updated_at: 1700000001,
  }

  it('parses a valid tag', () => {
    const result = TagSchema.parse(validTag)
    expect(result.id).toBe('tag_123')
    expect(result.name).toBe('Test Tag')
  })

  it('allows null children in _links.related', () => {
    const tagWithNullChildren = {
      ...validTag,
      _links: {
        ...validTag._links,
        related: {
          ...validTag._links.related,
          children: null,
        },
      },
    }
    const result = TagSchema.parse(tagWithNullChildren)
    expect(result._links.related.children).toBeNull()
  })

  it('allows undefined children in _links.related', () => {
    const tagWithoutChildren = {
      ...validTag,
      _links: {
        ...validTag._links,
        related: {
          conversations: validTag._links.related.conversations,
          owner: validTag._links.related.owner,
          // children omitted
        },
      },
    }
    const result = TagSchema.parse(tagWithoutChildren)
    expect(result._links.related.children).toBeUndefined()
  })

  it('accepts non-standard highlight colors', () => {
    // Front may add new colors beyond the known set
    const tagWithNewColor = {
      ...validTag,
      highlight: 'magenta', // Not in KnownTagHighlights
    }
    const result = TagSchema.parse(tagWithNewColor)
    expect(result.highlight).toBe('magenta')
  })

  it('accepts null highlight', () => {
    const tagWithNullHighlight = {
      ...validTag,
      highlight: null,
    }
    const result = TagSchema.parse(tagWithNullHighlight)
    expect(result.highlight).toBeNull()
  })

  it('accepts all known highlight colors', () => {
    for (const color of KnownTagHighlights) {
      const tagWithColor = {
        ...validTag,
        highlight: color,
      }
      const result = TagSchema.parse(tagWithColor)
      expect(result.highlight).toBe(color)
    }
  })
})

describe('TagHighlightSchema', () => {
  it('accepts any string color', () => {
    expect(TagHighlightSchema.parse('blue')).toBe('blue')
    expect(TagHighlightSchema.parse('magenta')).toBe('magenta')
    expect(TagHighlightSchema.parse('custom_color')).toBe('custom_color')
  })
})
