import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { find } from './find'
import { get } from './get'
import { stale, stats } from './stats'
import { store } from './store'
import { deleteMemory, downvote, upvote, validate } from './vote'

const buildContext = async (
  command: Command,
  json?: boolean
): Promise<CommandContext> => {
  const opts =
    typeof command.optsWithGlobals === 'function'
      ? command.optsWithGlobals()
      : {
          ...command.parent?.opts(),
          ...command.opts(),
        }
  return createContext({
    format: json ? 'json' : opts.format,
    verbose: opts.verbose,
    quiet: opts.quiet,
  })
}

/**
 * Register memory commands with Commander
 */
export function registerMemoryCommands(program: Command): void {
  const memory = program
    .command('memory')
    .description('Manage semantic memory for agent learning')

  memory
    .command('store')
    .description('Store a new memory')
    .argument('<content>', 'Memory content to store')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--app <app>', 'App slug to associate with memory')
    .option('--json', 'Output as JSON')
    .action(async (content, options, command) => {
      const ctx = await buildContext(command, options.json)
      await store(ctx, content, options)
    })

  memory
    .command('find')
    .description('Search memories by semantic similarity')
    .argument('<query>', 'Search query text')
    .option('--limit <number>', 'Max results (1-100, default: 10)')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--app <app>', 'Filter by app slug')
    .option(
      '--min-confidence <confidence>',
      'Minimum confidence threshold (0-1, default: 0.5)'
    )
    .option('--json', 'Output as JSON')
    .action(async (query, options, command) => {
      const ctx = await buildContext(command, options.json)
      await find(ctx, query, options)
    })

  memory
    .command('get')
    .description('Get a specific memory by ID')
    .argument('<id>', 'Memory ID')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--json', 'Output as JSON')
    .action(async (id, options, command) => {
      const ctx = await buildContext(command, options.json)
      await get(ctx, id, options)
    })

  memory
    .command('validate')
    .description('Validate a memory (resets decay clock)')
    .argument('<id>', 'Memory ID')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--json', 'Output as JSON')
    .action(async (id, options, command) => {
      const ctx = await buildContext(command, options.json)
      await validate(ctx, id, options)
    })

  memory
    .command('upvote')
    .description('Upvote a memory')
    .argument('<id>', 'Memory ID')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--reason <reason>', 'Optional reason for upvote')
    .option('--json', 'Output as JSON')
    .action(async (id, options, command) => {
      const ctx = await buildContext(command, options.json)
      await upvote(ctx, id, options)
    })

  memory
    .command('downvote')
    .description('Downvote a memory')
    .argument('<id>', 'Memory ID')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--reason <reason>', 'Optional reason for downvote')
    .option('--json', 'Output as JSON')
    .action(async (id, options, command) => {
      const ctx = await buildContext(command, options.json)
      await downvote(ctx, id, options)
    })

  memory
    .command('delete')
    .description('Delete a memory')
    .argument('<id>', 'Memory ID')
    .option('--collection <collection>', 'Collection name (default: learnings)')
    .option('--json', 'Output as JSON')
    .action(async (id, options, command) => {
      const ctx = await buildContext(command, options.json)
      await deleteMemory(ctx, id, options)
    })

  memory
    .command('stats')
    .description('Display memory statistics')
    .option('--collection <collection>', 'Filter by collection')
    .option('--app <app>', 'Filter by app slug')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await stats(ctx, options)
    })

  memory
    .command('stale')
    .description('List stale memories needing validation')
    .option('--collection <collection>', 'Filter by collection')
    .option('--threshold <threshold>', 'Confidence threshold (default: 0.25)')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await buildContext(command, options.json)
      await stale(ctx, options)
    })
}
