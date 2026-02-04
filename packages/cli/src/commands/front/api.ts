/**
 * Front CLI API passthrough
 *
 * Allows raw Front API requests for power users.
 */

import type { Command } from 'commander'
import { type CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getFrontClient } from './client'
import { hateoasWrap } from './hateoas'
import { contextFromCommand } from './with-context'

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const

type AllowedMethod = (typeof ALLOWED_METHODS)[number]

function normalizeMethod(method: string): AllowedMethod {
  const normalized = method.toUpperCase()
  if (!ALLOWED_METHODS.includes(normalized as AllowedMethod)) {
    throw new CLIError({
      userMessage: `Unsupported method: ${method}.`,
      suggestion: `Use one of: ${ALLOWED_METHODS.join(', ')}.`,
    })
  }
  return normalized as AllowedMethod
}

function normalizePath(path: string): string {
  if (path.startsWith('http')) return path
  if (path.startsWith('/')) return path
  return `/${path}`
}

function parseData(data?: string): unknown {
  if (!data) return undefined
  try {
    return JSON.parse(data)
  } catch (error) {
    throw new CLIError({
      userMessage: 'Invalid JSON for --data.',
      suggestion: 'Provide valid JSON, e.g. --data "{"key":"value"}"',
      cause: error,
    })
  }
}

export async function runFrontApi(
  ctx: CommandContext,
  method: string,
  path: string,
  options: {
    json?: boolean
    data?: string
    allowDestructive?: boolean
    dryRun?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const normalizedMethod = normalizeMethod(method)
    const normalizedPath = normalizePath(path)
    const isDestructive = normalizedMethod !== 'GET'

    if (isDestructive && !options.allowDestructive) {
      throw new CLIError({
        userMessage: `${normalizedMethod} requests require --allow-destructive.`,
        suggestion: 'Re-run with --allow-destructive once you are sure.',
      })
    }

    const payload = parseData(options.data)
    if (
      payload &&
      (normalizedMethod === 'GET' || normalizedMethod === 'DELETE')
    ) {
      throw new CLIError({
        userMessage: `${normalizedMethod} requests do not accept --data.`,
        suggestion: 'Remove --data or use a write method.',
      })
    }

    if (isDestructive && options.dryRun) {
      const preview = {
        dryRun: true,
        method: normalizedMethod,
        path: normalizedPath,
        data: payload,
      }

      if (outputJson) {
        ctx.output.data(
          hateoasWrap({
            type: 'front-api-dry-run',
            command: `skill front api ${normalizedMethod} ${normalizedPath} --json`,
            data: preview,
          })
        )
        return
      }

      ctx.output.data('🧪 DRY RUN: Front API request preview')
      ctx.output.data(JSON.stringify(preview, null, 2))
      ctx.output.data('')
      return
    }

    const front = getFrontClient()
    let result: unknown

    switch (normalizedMethod) {
      case 'GET':
        result = await front.raw.get(normalizedPath)
        break
      case 'POST':
        result = await front.raw.post(normalizedPath, payload ?? {})
        break
      case 'PATCH':
        result = await front.raw.patch(normalizedPath, payload ?? {})
        break
      case 'DELETE':
        result = await front.raw.delete(normalizedPath)
        break
      default:
        throw new CLIError({
          userMessage: `Unsupported method: ${normalizedMethod}.`,
        })
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'front-api-response',
          command: `skill front api ${normalizedMethod} ${normalizedPath} --json`,
          data: result,
        })
      )
      return
    }

    ctx.output.data(`Front API ${normalizedMethod} ${normalizedPath}`)
    ctx.output.data(JSON.stringify(result, null, 2))
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Front API passthrough failed.',
            suggestion: 'Verify method, path, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerApiCommand(front: Command): void {
  front
    .command('api')
    .description('Raw Front API passthrough')
    .argument('<method>', 'HTTP method (GET, POST, PATCH, DELETE)')
    .argument('<path>', 'API path (e.g., /inboxes)')
    .option('--data <json>', 'JSON payload for POST/PATCH/DELETE')
    .option('--allow-destructive', 'Allow write requests')
    .option('--dry-run', 'Preview a write request without executing')
    .option('--json', 'Output as JSON')
    .action(
      async (
        method: string,
        path: string,
        options: {
          json?: boolean
          data?: string
          allowDestructive?: boolean
          dryRun?: boolean
        },
        command: Command
      ) => {
        const ctx = await contextFromCommand(command, options)
        await runFrontApi(ctx, method, path, options)
      }
    )
}
