import type { Command } from 'commander'
import { decryptAction } from './decrypt'
import { encryptAction } from './encrypt'
import { keygen } from './keygen'
import { statusAction } from './status'

/**
 * Register auth commands with Commander
 */
export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage encrypted secrets for CLI distribution')

  auth
    .command('keygen')
    .description('Generate age keypair for encryption')
    .option('--output <path>', 'Write keypair to file')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await keygen(options)
    })

  auth
    .command('encrypt')
    .description('Encrypt a file with age public key')
    .argument('<input>', 'Input file path')
    .option('--output <path>', 'Output file path (default: <input>.age)')
    .option('--recipient <key>', 'Age public key (or read from AGE_PUBLIC_KEY)')
    .option('--json', 'Output as JSON')
    .action(encryptAction)

  auth
    .command('decrypt')
    .description('Decrypt a file with age private key')
    .argument('<input>', 'Input file path (.age)')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option(
      '--identity <key>',
      'Age private key, file path, or 1Password ref (op://...)'
    )
    .option('--json', 'Output as JSON')
    .action(decryptAction)

  auth
    .command('status')
    .description('Check encryption setup status')
    .option('--json', 'Output as JSON')
    .action(statusAction)
}
