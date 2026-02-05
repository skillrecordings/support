import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  JsonFormatter,
  TableFormatter,
  TextFormatter,
  createOutputFormatter,
  resolveOutputFormat,
} from '../../../src/core/output'

const createCapture = () => {
  const stream = new PassThrough() as NodeJS.WriteStream
  let output = ''
  stream.on('data', (chunk) => {
    output += chunk.toString()
  })
  return { stream, read: () => output }
}

describe('OutputFormatter', () => {
  it('writes JSON data to stdout', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    const formatter = new JsonFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
    })

    formatter.data({ ok: true })

    await new Promise((resolve) => setImmediate(resolve))
    expect(stdout.read()).toBe('{"ok":true}\n')
    expect(stderr.read()).toBe('')
  })

  it('writes human-readable text data to stdout', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    const formatter = new TextFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
    })

    formatter.data({ status: 'ok' })

    await new Promise((resolve) => setImmediate(resolve))
    expect(stdout.read()).toContain('status')
    expect(stderr.read()).toBe('')
  })

  it('renders aligned tables', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    const formatter = new TableFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
    })

    formatter.data([
      { name: 'alpha', count: 2 },
      { name: 'beta-long', count: 12 },
    ])

    await new Promise((resolve) => setImmediate(resolve))
    const output = stdout
      .read()
      .trimEnd()
      .split('\n')
      .map((line) => line.trimEnd())
    expect(output[0]).toBe('name       count')
    expect(output[1]).toBe('alpha      2')
    expect(output[2]).toBe('beta-long  12')
    expect(stderr.read()).toBe('')
  })

  it('respects quiet mode for non-error messages', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    const formatter = new TextFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
      quiet: true,
    })

    formatter.message('note')
    formatter.success('done')
    formatter.warn('heads up')
    formatter.progress('working')
    formatter.error('fail')

    await new Promise((resolve) => setImmediate(resolve))
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toBe('ERROR: fail\n')
  })

  it('emits progress only when verbose', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    const formatter = new TextFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
      verbose: true,
    })

    formatter.progress('working')

    await new Promise((resolve) => setImmediate(resolve))
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toBe('working\n')
  })

  it('auto-detects JSON when stdout is not a TTY', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    ;(stdout.stream as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = false

    const formatter = createOutputFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
    })

    formatter.data({ ok: true })

    await new Promise((resolve) => setImmediate(resolve))
    expect(stdout.read()).toBe('{"ok":true}\n')
  })

  it('prefers explicit output format over TTY detection', () => {
    const stdout = createCapture()
    ;(stdout.stream as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = false

    const format = resolveOutputFormat('table', stdout.stream)

    expect(format).toBe('table')
  })

  it('renders table payloads with explicit columns', async () => {
    const stdout = createCapture()
    const stderr = createCapture()
    const formatter = new TableFormatter({
      stdout: stdout.stream,
      stderr: stderr.stream,
    })

    formatter.data({
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: 'alpha', count: 2 }],
    })

    await new Promise((resolve) => setImmediate(resolve))
    const output = stdout
      .read()
      .trimEnd()
      .split('\n')
      .map((line) => line.trimEnd())
    expect(output[0]).toBe('Name')
    expect(output[1]).toBe('alpha')
    expect(stderr.read()).toBe('')
  })
})
