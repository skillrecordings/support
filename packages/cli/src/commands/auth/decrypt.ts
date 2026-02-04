import path from 'path'
import fs from 'fs/promises'
import { decrypt } from '../../lib/crypto'
import { isServiceAccountConfigured, readSecret } from '../../lib/onepassword'

interface DecryptOptions {
  output?: string
  identity?: string
  json?: boolean
}

/**
 * Decrypt a file with an age private key
 * @param input - Path to encrypted file (.age)
 * @param options - Command options
 */
export async function decryptAction(
  input: string,
  options: DecryptOptions
): Promise<void> {
  try {
    // Resolve identity key using priority: --identity flag > AGE_SECRET_KEY env > 1Password
    let privateKey: string | undefined

    if (options.identity) {
      // If starts with AGE-SECRET-KEY, use directly
      if (options.identity.startsWith('AGE-SECRET-KEY-')) {
        privateKey = options.identity
      }
      // If starts with op://, use 1Password
      else if (options.identity.startsWith('op://')) {
        if (isServiceAccountConfigured()) {
          privateKey = await readSecret(options.identity)
        } else {
          const error =
            '1Password reference provided but OP_SERVICE_ACCOUNT_TOKEN not set'
          if (options.json) {
            console.log(JSON.stringify({ success: false, error }))
          } else {
            console.error(`Error: ${error}`)
          }
          process.exit(1)
        }
      }
      // Otherwise treat as file path
      else {
        privateKey = (await fs.readFile(options.identity, 'utf-8')).trim()
      }
    }

    // Fall back to AGE_SECRET_KEY env var
    if (!privateKey) {
      privateKey = process.env.AGE_SECRET_KEY
    }

    if (!privateKey) {
      const error =
        'No private key specified. Use --identity <key|file|op://ref> or set AGE_SECRET_KEY environment variable.'
      if (options.json) {
        console.log(JSON.stringify({ success: false, error }))
      } else {
        console.error(`Error: ${error}`)
      }
      process.exit(1)
    }

    // Validate private key format
    if (!privateKey.startsWith('AGE-SECRET-KEY-')) {
      const error = `Invalid private key format. Expected AGE-SECRET-KEY-1..., got: ${privateKey.slice(0, 15)}...`
      if (options.json) {
        console.log(JSON.stringify({ success: false, error }))
      } else {
        console.error(`Error: ${error}`)
      }
      process.exit(1)
    }

    // Read encrypted file
    const encryptedData = await fs.readFile(input)

    // Decrypt
    const decrypted = await decrypt(encryptedData, privateKey)

    // Determine output
    if (options.output) {
      // Write to file
      await fs.writeFile(options.output, decrypted, 'utf-8')

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            input: path.resolve(input),
            output: path.resolve(options.output),
          })
        )
      } else {
        console.log(`✓ Decrypted ${input} → ${options.output}`)
      }
    } else {
      // Write to stdout
      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            input: path.resolve(input),
            content: decrypted,
          })
        )
      } else {
        console.log(decrypted)
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (options.json) {
      console.log(JSON.stringify({ success: false, error }))
    } else {
      console.error(`Error: ${error}`)
    }
    process.exit(1)
  }
}
