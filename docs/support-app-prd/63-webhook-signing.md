# Webhook Signing

HMAC-SHA256 over raw body with shared secret. Stripe-style format with replay protection.

```
x-support-signature: t=1705512000,v1=5257a869...,v1=oldkeysig...
```

- Timestamp (`t`) + 5 minute tolerance
- Multiple `v1` signatures for key rotation
- Verify: `HMAC-SHA256(timestamp + "." + rawBody, webhookSecret)`

```typescript
function verifySignature(payload: string, header: string, secrets: string[]): boolean {
  const { timestamp, signatures } = parseHeader(header)

  if (Date.now() - timestamp > 5 * 60 * 1000) return false

  const signedPayload = `${timestamp}.${payload}`

  return secrets.some(secret =>
    signatures.some(sig =>
      timingSafeEqual(hmacSha256(signedPayload, secret), Buffer.from(sig, 'hex'))
    )
  )
}
```

