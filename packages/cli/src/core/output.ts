import { inspect } from 'node:util'

export type OutputFormat = 'json' | 'text' | 'table'

export type TableColumn = string | { key: string; label?: string }
export type TableRow = Record<string, unknown>

export interface OutputFormatter {
  data(value: unknown): void
  table(rows: TableRow[], columns?: TableColumn[]): void
  message(text: string): void
  success(text: string): void
  warn(text: string): void
  error(text: string): void
  progress(label: string): void
}

export interface OutputFormatterConfig {
  format?: OutputFormat
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
  verbose?: boolean
  quiet?: boolean
}

const writeLine = (stream: NodeJS.WriteStream, line: string): void => {
  stream.write(`${line}\n`)
}

const valueToCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

const normalizeColumns = (
  columns: TableColumn[] | undefined,
  rows: TableRow[]
): { key: string; label: string }[] => {
  if (columns && columns.length > 0) {
    return columns.map((column) =>
      typeof column === 'string'
        ? { key: column, label: column }
        : { key: column.key, label: column.label ?? column.key }
    )
  }
  if (rows.length === 0) return []
  const firstRow = rows[0] as TableRow
  return Object.keys(firstRow).map((key) => ({ key, label: key }))
}

const renderTable = (rows: TableRow[], columns?: TableColumn[]): string[] => {
  const normalized = normalizeColumns(columns, rows)
  if (normalized.length === 0) return []

  const widths = normalized.map((column) => column.label.length)

  for (const row of rows) {
    normalized.forEach((column, index) => {
      const cell = valueToCell(row[column.key])
      const currentWidth = widths[index] ?? 0
      widths[index] = Math.max(currentWidth, cell.length)
    })
  }

  const pad = (value: string, width: number): string => value.padEnd(width, ' ')

  const header = normalized
    .map((column, index) => pad(column.label, widths[index] ?? 0))
    .join('  ')
  const lines = [header]

  for (const row of rows) {
    const line = normalized
      .map((column, index) =>
        pad(valueToCell(row[column.key]), widths[index] ?? 0)
      )
      .join('  ')
    lines.push(line)
  }

  return lines
}

const isTablePayload = (
  value: unknown
): value is { rows: TableRow[]; columns?: TableColumn[] } => {
  if (!value || typeof value !== 'object') return false
  if (!('rows' in value)) return false
  const rows = (value as { rows?: unknown }).rows
  return Array.isArray(rows)
}

const isRowArray = (value: unknown): value is TableRow[] =>
  Array.isArray(value) &&
  value.every(
    (row) => typeof row === 'object' && row !== null && !Array.isArray(row)
  )

const formatHumanReadable = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return inspect(value, { depth: null, colors: false })
}

export const resolveOutputFormat = (
  format: OutputFormat | undefined,
  stdout: NodeJS.WriteStream
): OutputFormat => {
  if (format) return format
  return stdout.isTTY ? 'text' : 'json'
}

export const createOutputFormatter = (
  config: OutputFormatterConfig
): OutputFormatter => {
  const format = resolveOutputFormat(config.format, config.stdout)

  switch (format) {
    case 'json':
      return new JsonFormatter(config)
    case 'table':
      return new TableFormatter(config)
    case 'text':
    default:
      return new TextFormatter(config)
  }
}

class BaseFormatter {
  protected stdout: NodeJS.WriteStream
  protected stderr: NodeJS.WriteStream
  protected verbose: boolean
  protected quiet: boolean

  constructor(config: OutputFormatterConfig) {
    this.stdout = config.stdout
    this.stderr = config.stderr
    this.verbose = config.verbose ?? false
    this.quiet = config.quiet ?? false
  }

  protected writeStdout(line: string): void {
    writeLine(this.stdout, line)
  }

  protected writeStderr(line: string): void {
    writeLine(this.stderr, line)
  }

  protected shouldWriteMessage(): boolean {
    return !this.quiet
  }

  protected shouldWriteProgress(): boolean {
    return this.verbose && !this.quiet
  }
}

export class JsonFormatter extends BaseFormatter implements OutputFormatter {
  data(value: unknown): void {
    this.writeStdout(JSON.stringify(value))
  }

  table(rows: TableRow[], columns?: TableColumn[]): void {
    const normalized = normalizeColumns(columns, rows)
    const payload = {
      columns: normalized.map((column) => column.label),
      rows,
    }
    this.data(payload)
  }

  message(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(text)
  }

  success(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(`SUCCESS: ${text}`)
  }

  warn(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(`WARN: ${text}`)
  }

  error(text: string): void {
    this.writeStderr(`ERROR: ${text}`)
  }

  progress(label: string): void {
    if (this.shouldWriteProgress()) this.writeStderr(label)
  }
}

export class TextFormatter extends BaseFormatter implements OutputFormatter {
  data(value: unknown): void {
    this.writeStdout(formatHumanReadable(value))
  }

  table(rows: TableRow[], columns?: TableColumn[]): void {
    const lines = renderTable(rows, columns)
    if (lines.length === 0) return
    for (const line of lines) {
      this.writeStdout(line)
    }
  }

  message(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(text)
  }

  success(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(`SUCCESS: ${text}`)
  }

  warn(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(`WARN: ${text}`)
  }

  error(text: string): void {
    this.writeStderr(`ERROR: ${text}`)
  }

  progress(label: string): void {
    if (this.shouldWriteProgress()) this.writeStderr(label)
  }
}

export class TableFormatter extends BaseFormatter implements OutputFormatter {
  data(value: unknown): void {
    if (isTablePayload(value)) {
      this.table(value.rows, value.columns)
      return
    }
    if (isRowArray(value)) {
      this.table(value)
      return
    }

    this.writeStdout(formatHumanReadable(value))
  }

  table(rows: TableRow[], columns?: TableColumn[]): void {
    const lines = renderTable(rows, columns)
    if (lines.length === 0) return
    for (const line of lines) {
      this.writeStdout(line)
    }
  }

  message(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(text)
  }

  success(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(`SUCCESS: ${text}`)
  }

  warn(text: string): void {
    if (this.shouldWriteMessage()) this.writeStderr(`WARN: ${text}`)
  }

  error(text: string): void {
    this.writeStderr(`ERROR: ${text}`)
  }

  progress(label: string): void {
    if (this.shouldWriteProgress()) this.writeStderr(label)
  }
}
