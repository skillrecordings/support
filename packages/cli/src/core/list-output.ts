import type { CommandContext } from './context'

export type ListOutputFormat = 'json' | 'ndjson' | 'csv'

const writeLine = (ctx: CommandContext, line: string): void => {
  ctx.stdout.write(`${line}\n`)
}

const toCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value)
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

const normalizeRows = (
  items: unknown[]
): {
  columns: string[]
  rows: Array<Record<string, unknown>>
} => {
  if (items.length === 0) return { columns: [], rows: [] }

  const first = items[0]
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const columns = Object.keys(first as Record<string, unknown>)
    const rows = items.map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { value: item }
    )
    return { columns, rows }
  }

  return {
    columns: ['value'],
    rows: items.map((item) => ({ value: item })),
  }
}

export const isListOutputFormat = (
  value: string | undefined
): value is ListOutputFormat => {
  return value === 'json' || value === 'ndjson' || value === 'csv'
}

export const outputList = (
  ctx: CommandContext,
  items: unknown[],
  format: ListOutputFormat
): void => {
  if (format === 'json') {
    writeLine(ctx, JSON.stringify(items))
    return
  }

  if (format === 'ndjson') {
    for (const item of items) {
      writeLine(ctx, JSON.stringify(item))
    }
    return
  }

  const { columns, rows } = normalizeRows(items)
  if (columns.length === 0) return
  writeLine(ctx, columns.map(toCsvCell).join(','))
  for (const row of rows) {
    const line = columns.map((column) => toCsvCell(row[column])).join(',')
    writeLine(ctx, line)
  }
}
