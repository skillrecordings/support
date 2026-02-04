import path from 'path'
import fs from 'fs/promises'
import { encrypt } from '../../lib/crypto'

interface EncryptOptions {
  output?: string
  recipient?: string
  json?: boolean
}

/**
 * Encrypt a file with an age public key
 * @param input - Path to input file
 * @param options - Command options
 */
export async function encryptAction(
  input: string,
  options: EncryptOptions
): Promise<void> {
  try {
    // Get recipient key from --recipient or AGE_PUBLIC_KEY env
    const recipientKey = options.recipient || process.env.AGE_PUBLIC_KEY

    if (!recipientKey) {
      const error =
        'No recipient key specified. Use --recipient or set AGE_PUBLIC_KEY environment variable.'
      if (options.json) {
        console.log(JSON.stringify({ success: false, error }))
      } else {
        console.error(`Error: ${error}`)
      }
      process.exit(1)
    }

    // Validate recipient key format (age1...)
    if (!recipientKey.startsWith('age1')) {
      const error = `Invalid recipient key format. Expected age1..., got: ${recipientKey.slice(0, 10)}...`
      if (options.json) {
        console.log(JSON.stringify({ success: false, error }))
      } else {
        console.error(`Error: ${error}`)
      }
      process.exit(1)
    }

    // Read input file
    const data = await fs.readFile(input, 'utf-8')

    // Encrypt
    const encrypted = await encrypt(data, recipientKey)

    // Determine output path
    const outputPath = options.output || `${input}.age`

    // Write encrypted data
    await fs.writeFile(outputPath, encrypted)

    // Output success
    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          input: path.resolve(input),
          output: path.resolve(outputPath),
          recipientKey: recipientKey.slice(0, 10) + '...',
        })
      )
    } else {
      console.log(`✓ Encrypted ${input} → ${outputPath}`)
      console.log(`  Recipient: ${recipientKey.slice(0, 10)}...`)
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
