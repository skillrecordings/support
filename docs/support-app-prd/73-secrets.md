# Secrets + Encryption

Avoid platform env sprawl. Store third-party secrets encrypted in the DB.

## Approach

- Encrypt at rest with envelope encryption
- Per-app context for crypto isolation
- KMS-backed master key (AWS/GCP/Azure) for KEK

## What Gets Encrypted

- Stripe keys (Connect, webhook secrets)
- Front/Slack tokens
- OAuth refresh tokens
- Any app integration secrets

```typescript
const dek = await kms.generateDataKey({ keyId: MASTER_KEY_ID })
const ciphertext = encryptWithDek(plaintext, dek.plaintext)
store({ ciphertext, encryptedDek: dek.ciphertextBlob, appId })
```

## Rotation

- Support multiple KEKs (active + previous)
- Re-encrypt DEKs asynchronously during low-traffic windows
- Log decrypt usage for audit

## Suggested Schema

```sql
CREATE TABLE app_secrets (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES apps(id),
  provider TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  encrypted_dek BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

