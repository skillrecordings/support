# CLI Auth - Encrypted Secrets Distribution

Age encryption system for distributing CLI secrets to team members via 1Password.

## Overview

The auth system uses [age encryption](https://github.com/FiloSottile/age) to distribute encrypted environment files to team members. Admins encrypt secrets once, share the encrypted file publicly (git, Slack, etc.), and store the decryption key in 1Password. Team members with 1Password Service Account tokens can decrypt automatically.

**Key benefits:**
- Encrypted files can be committed to git or shared in Slack
- No manual copy/paste of credentials
- Automatic decryption via 1Password integration
- Key rotation without redistributing encrypted files

## Quick Start

### Team Member Setup (Decrypt Secrets)

1. Get 1Password Service Account token from admin
2. Set token in your shell:
   ```bash
   export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"
   ```
3. Decrypt the shared `.env.local.age` file:
   ```bash
   skill auth decrypt .env.local.age --output .env.local
   ```

The CLI automatically reads the age private key from 1Password using the reference stored in `AGE_SECRET_KEY` env var.

### Admin Setup (First Time)

1. Generate keypair:
   ```bash
   skill auth keygen
   ```
2. Store private key in 1Password vault
3. Create secret reference in env:
   ```bash
   # In your .env.local (DO NOT commit)
   AGE_SECRET_KEY="op://Private/cli-age-key/private_key"
   ```
4. Encrypt secrets:
   ```bash
   skill auth encrypt .env.local
   ```
5. Share `.env.local.age` (safe to commit/share)
6. Share the 1Password Service Account token with team

## Commands Reference

### `skill auth keygen`

Generate an age encryption keypair.

```bash
# Output to stdout (public key) and stderr (private key with warning)
skill auth keygen

# Save to file
skill auth keygen --output keypair.txt

# JSON output
skill auth keygen --json
```

**Output:**
- Public key: `age1...` (share this)
- Private key: `AGE-SECRET-KEY-1...` (KEEP SECRET)

**Options:**
- `--output <path>` - Write keypair to file
- `--json` - Output as JSON

**Security:** Private key is written to stderr with warnings in normal mode. Store it securely in 1Password.

### `skill auth encrypt`

Encrypt a file with an age public key.

```bash
# Encrypt using AGE_PUBLIC_KEY env var
skill auth encrypt .env.local

# Specify recipient key explicitly
skill auth encrypt .env.local --recipient age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p

# Custom output path
skill auth encrypt .env.local --output secrets.age

# JSON output
skill auth encrypt .env.local --json
```

**Arguments:**
- `<input>` - Path to file to encrypt

**Options:**
- `--output <path>` - Output file path (default: `<input>.age`)
- `--recipient <key>` - Age public key (or use `AGE_PUBLIC_KEY` env var)
- `--json` - Output as JSON

**Environment:**
- `AGE_PUBLIC_KEY` - Default recipient key if `--recipient` not provided

**Exit codes:**
- `0` - Success
- `1` - Error (missing recipient, invalid key format, file not found)

### `skill auth decrypt`

Decrypt a file with an age private key.

```bash
# Decrypt to stdout (using AGE_SECRET_KEY env var)
skill auth decrypt .env.local.age

# Decrypt to file
skill auth decrypt .env.local.age --output .env.local

# Use 1Password reference (automatic with OP_SERVICE_ACCOUNT_TOKEN set)
skill auth decrypt .env.local.age --identity "op://Private/cli-age-key/private_key"

# Use private key from file
skill auth decrypt .env.local.age --identity /path/to/key.txt

# Use private key directly
skill auth decrypt .env.local.age --identity "AGE-SECRET-KEY-1..."

# JSON output
skill auth decrypt .env.local.age --json
```

**Arguments:**
- `<input>` - Path to encrypted file (`.age`)

**Options:**
- `--output <path>` - Output file path (default: stdout)
- `--identity <key>` - Private key, file path, or 1Password reference (`op://...`)
- `--json` - Output as JSON

**Identity resolution priority:**
1. `--identity` flag value
2. `AGE_SECRET_KEY` environment variable
3. Error if none provided

**Environment:**
- `AGE_SECRET_KEY` - Default private key or 1Password reference
- `OP_SERVICE_ACCOUNT_TOKEN` - Required for 1Password references

**Exit codes:**
- `0` - Success
- `1` - Error (missing identity, invalid key format, decryption failed)

### `skill auth status`

Check encryption setup status.

```bash
skill auth status
skill auth status --json
```

**Status checks:**
- Is 1Password CLI (`op`) installed?
- Is `OP_SERVICE_ACCOUNT_TOKEN` set?
- Can we read age keys from 1Password?
- Are `AGE_PUBLIC_KEY` and `AGE_SECRET_KEY` configured?

**Options:**
- `--json` - Output as JSON

**Note:** This command is a placeholder and will be implemented by another worker.

## Distribution Workflow

### Admin: Generate and Distribute Keys

1. **Generate keypair:**
   ```bash
   skill auth keygen --json > keypair.json
   ```

2. **Store private key in 1Password:**
   - Open 1Password vault
   - Create new item: "cli-age-key"
   - Add field: `private_key` with value from `keypair.json`
   - Note the secret reference: `op://Private/cli-age-key/private_key`

3. **Configure local environment:**
   ```bash
   # In packages/cli/.env.local (DO NOT commit)
   AGE_PUBLIC_KEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
   AGE_SECRET_KEY="op://Private/cli-age-key/private_key"
   ```

4. **Encrypt secrets:**
   ```bash
   cd packages/cli
   skill auth encrypt .env.local
   # Creates .env.local.age
   ```

5. **Distribute:**
   - Share `.env.local.age` (safe to commit or share via Slack)
   - Share 1Password Service Account token with team (securely)
   - Document the setup in team docs

### Team: Decrypt Secrets

1. **Set 1Password Service Account token:**
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"
   ```

2. **Configure environment to use 1Password reference:**
   ```bash
   # In packages/cli/.env.local
   AGE_SECRET_KEY="op://Private/cli-age-key/private_key"
   ```

3. **Decrypt secrets:**
   ```bash
   cd packages/cli
   skill auth decrypt .env.local.age --output .env.local
   ```

4. **Verify:**
   ```bash
   cat .env.local | head -5
   ```

## 1Password Service Account Setup

Service accounts enable headless authentication for CI/CD and team automation.

### Create Service Account

1. **Open 1Password:**
   - Go to Integrations > Service Accounts
   - Click "Create Service Account"
   - Name it: "CLI Secrets Distribution"

2. **Configure Access:**
   - Grant read access to the vault containing age keys
   - Note: Service accounts can't use 2FA or sign in to apps

3. **Generate Token:**
   - Copy the token (`ops_xxx...`)
   - Store it securely (only shown once)

4. **Share with Team:**
   - Send token securely (avoid Slack/email if possible)
   - Document in team setup guide

### Set Token

```bash
# Temporary (current shell session)
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"

# Permanent (add to shell profile)
echo 'export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"' >> ~/.bashrc
source ~/.bashrc
```

### Store Age Key in Vault

1. **Create Item:**
   - Open 1Password vault
   - Create new item (type: "Secure Note" or "Password")
   - Title: "cli-age-key"

2. **Add Private Key Field:**
   - Add custom field: `private_key`
   - Paste age private key: `AGE-SECRET-KEY-1...`

3. **Note Reference:**
   - Reference format: `op://VaultName/ItemName/FieldName`
   - Example: `op://Private/cli-age-key/private_key`

### Use 1Password Reference

```bash
# In environment file (safe to commit)
AGE_SECRET_KEY="op://Private/cli-age-key/private_key"

# Decrypt will automatically resolve the reference
skill auth decrypt .env.local.age --output .env.local
```

### Troubleshooting 1Password

**"op: command not found"**
- Install 1Password CLI: https://developer.1password.com/docs/cli/get-started/

**"OP_SERVICE_ACCOUNT_TOKEN not set"**
- Export token: `export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"`
- Verify: `echo $OP_SERVICE_ACCOUNT_TOKEN`

**"Failed to read secret from 1Password"**
- Check token has access to vault: `op vault list`
- Verify reference format: `op://VaultName/ItemName/FieldName`
- Test read directly: `op read "op://Private/cli-age-key/private_key"`

**"Invalid secret reference format"**
- Reference must start with `op://`
- Format: `op://VaultName/ItemName/FieldName`
- Use exact vault/item/field names (case-sensitive)

## Key Rotation

Rotate keys periodically or when team members leave.

### 1. Generate New Keypair

```bash
skill auth keygen --json > new-keypair.json
```

### 2. Update 1Password Vault

- Open "cli-age-key" item in 1Password
- Update `private_key` field with new private key
- Keep old key in history for emergency decryption

### 3. Re-encrypt All Secrets

```bash
# Update AGE_PUBLIC_KEY in env
export AGE_PUBLIC_KEY="<new-public-key>"

# Re-encrypt all secret files
skill auth encrypt .env.local --output .env.local.age
skill auth encrypt apps/web/.env.local --output apps/web/.env.local.age
skill auth encrypt apps/slack/.env.local --output apps/slack/.env.local.age
```

### 4. Distribute New Encrypted Files

- Commit updated `.age` files to git
- Or share via your distribution channel
- Team members can decrypt with same 1Password reference (key updated in vault)

### 5. Notify Team

Send notification with:
- Date of key rotation
- Reason (routine, security incident, team change)
- Action required (pull latest `.age` files, re-decrypt)

## Troubleshooting

### "No recipient key specified"

**Cause:** `AGE_PUBLIC_KEY` env var not set and `--recipient` not provided.

**Fix:**
```bash
export AGE_PUBLIC_KEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
# Or use --recipient flag
```

### "No private key specified"

**Cause:** `AGE_SECRET_KEY` env var not set and `--identity` not provided.

**Fix:**
```bash
export AGE_SECRET_KEY="op://Private/cli-age-key/private_key"
# Or use --identity flag
```

### "Invalid recipient key format"

**Cause:** Public key doesn't start with `age1`.

**Fix:** Generate new keypair with `skill auth keygen` or verify key was copied correctly.

### "Invalid private key format"

**Cause:** Private key doesn't start with `AGE-SECRET-KEY-1`.

**Fix:** Generate new keypair with `skill auth keygen` or verify key was copied correctly.

### "1Password reference provided but OP_SERVICE_ACCOUNT_TOKEN not set"

**Cause:** Using `op://` reference without setting service account token.

**Fix:**
```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"
```

### "Failed to read secret from 1Password"

**Cause:** Invalid reference, vault access issue, or 1Password CLI not authenticated.

**Fix:**
1. Verify reference format: `op://VaultName/ItemName/FieldName`
2. Test direct read: `op read "op://Private/cli-age-key/private_key"`
3. Check vault access: `op vault list`
4. Verify service account permissions

### Decryption fails with "bad ciphertext"

**Cause:** Private key doesn't match the public key used for encryption.

**Fix:**
- Verify you're using the correct private key
- Check if key rotation occurred (get new encrypted file)
- Ensure private key wasn't truncated or modified

## Security Best Practices

1. **Never commit private keys**
   - Private keys go in 1Password only
   - Use `.env.local` (gitignored) for local development
   - Use `op://` references in config files

2. **Rotate keys regularly**
   - Rotate keys every 90 days or when team changes
   - Keep rotation history for emergency decryption
   - Document rotation dates

3. **Limit service account access**
   - Grant read-only access to specific vaults
   - Create separate service accounts for different purposes
   - Audit access logs regularly

4. **Verify encrypted files**
   - Test decryption after encryption
   - Verify file integrity before distribution
   - Keep backups of encrypted files

5. **Monitor access**
   - Use 1Password audit logs to track secret access
   - Set up alerts for suspicious activity
   - Review service account usage monthly

## Related Documentation

- [CLI README](../README.md) - Overview of all CLI commands
- [1Password Service Accounts](https://developer.1password.com/docs/service-accounts/) - Official docs
- [age encryption](https://github.com/FiloSottile/age) - Encryption tool used
- [Environment Setup](../../../docs/ENV.md) - Repository environment configuration
