import {
  Decrypter,
  Encrypter,
  generateIdentity,
  identityToRecipient,
} from 'age-encryption'

export interface Keypair {
  publicKey: string
  privateKey: string
}

/**
 * Generate an age keypair
 * @returns Keypair with publicKey (age1...) and privateKey (AGE-SECRET-KEY-1...)
 */
export async function generateKeypair(): Promise<Keypair> {
  const privateKey = await generateIdentity()
  const publicKey = await identityToRecipient(privateKey)
  return { publicKey, privateKey }
}

/**
 * Encrypt data with an age public key
 * @param data - String or Buffer to encrypt
 * @param recipientPublicKey - age public key (age1...)
 * @returns Encrypted data as Uint8Array
 */
export async function encrypt(
  data: string | Buffer,
  recipientPublicKey: string
): Promise<Uint8Array> {
  const encrypter = new Encrypter()
  encrypter.addRecipient(recipientPublicKey)

  const input = typeof data === 'string' ? data : new TextDecoder().decode(data)
  return encrypter.encrypt(input)
}

/**
 * Decrypt data with an age private key
 * @param encrypted - Encrypted data as Uint8Array or Buffer
 * @param privateKey - age private key (AGE-SECRET-KEY-1...)
 * @returns Decrypted data as string
 */
export async function decrypt(
  encrypted: Uint8Array | Buffer,
  privateKey: string
): Promise<string> {
  const decrypter = new Decrypter()
  decrypter.addIdentity(privateKey)

  const input =
    encrypted instanceof Buffer ? new Uint8Array(encrypted) : encrypted
  return decrypter.decrypt(input, 'text')
}
