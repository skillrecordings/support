import { Decrypter } from 'age-encryption'

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
