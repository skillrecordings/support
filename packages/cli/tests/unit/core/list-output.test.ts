import { describe, expect, it } from 'vitest'
import { toCsvCell } from '../../../src/core/list-output'

describe('CSV output sanitization', () => {
  it('sanitizes formula injection in strings starting with =', () => {
    expect(toCsvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"')
  })

  it('sanitizes formula injection in strings starting with +', () => {
    expect(toCsvCell('+1+2')).toBe("'+1+2")
  })

  it('sanitizes formula injection in strings starting with -', () => {
    expect(toCsvCell('-1+2')).toBe("'-1+2")
  })

  it('sanitizes formula injection in strings starting with @', () => {
    expect(toCsvCell('@cmd')).toBe("'@cmd")
  })

  it('sanitizes formula injection in strings starting with tab or CR', () => {
    expect(toCsvCell('\tvalue')).toBe("'\tvalue")
    expect(toCsvCell('\rvalue')).toBe("'\rvalue")
  })

  it('does NOT sanitize negative numbers', () => {
    expect(toCsvCell(-5)).toBe('-5')
  })

  it('does NOT sanitize boolean values', () => {
    expect(toCsvCell(true)).toBe('true')
    expect(toCsvCell(false)).toBe('false')
  })

  it('handles normal strings unchanged', () => {
    expect(toCsvCell('hello')).toBe('hello')
  })

  it('still quotes strings with commas', () => {
    expect(toCsvCell('hello,world')).toBe('"hello,world"')
  })

  it('still quotes strings with newlines', () => {
    expect(toCsvCell('hello\nworld')).toBe('"hello\nworld"')
  })

  it('handles null and undefined as empty string', () => {
    expect(toCsvCell(null)).toBe('')
    expect(toCsvCell(undefined)).toBe('')
  })
})
