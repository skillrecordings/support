# CLI Auth - Encrypted Secrets Distribution

Age encryption system for distributing CLI secrets to team members via 1Password.

## Overview

The auth system uses [age encryption](https://github.com/FiloSottile/age) to distribute encrypted environment files to team members. Admins encrypt secrets once, commit the encrypted file to git, and store the decryption key in 1Password. Team members with the 1Password Service Account token file get **automatic, transparent decryption** - they just run `skill` and it works.

**Key benefits:**
- Encrypted file committed to git (`.env.encrypted`)
- **Zero-config for team** - just drop `~/.op-token` and run CLI
- Automatic decryption via 1Password integration
- Key rotation without redistributing encrypted files
- Local `.env.local` overrides encrypted file for development

## Quick Start

### Team Member Setup (Zero-Config)

1. Get `~/.op-token` file from admin (contains 1Password Service Account token)
2. Place it at `~/.op-token`:
   ```bash
   # File contents:
   export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx..."
   ```
3. **That's it** - run any `skill` command:
   ```bash
   skill db-status  # Just works - secrets auto-loaded from 1Password
   ```

The CLI automatically:
1. Detects `~/.op-token` exists
2. Reads the service account token
3. Fetches the age private key from 1Password (`op://Support/skill-cli-age-key/private_key`)
4. Decrypts `.env.encrypted` on the fly
5. Injects secrets into the environment

### Local Development (Priority Override)

If you have a local `.env.local` file, it takes priority over the encrypted file:

```bash
# packages/cli/.env.local exists? → used directly, no decryption needed
# packages/cli/.env.local missing? → auto-decrypt .env.encrypted via 1Password
```

This means:
- Your local overrides always win
- You can modify values without affecting team
- Production secrets stay in sync via encrypted file

### Admin Setup (First Time)

1. Generate keypair:
   ```bash
   skill auth keygen
   ```
2. Store private key in 1Password:
   - Vault: `Support`
   - Item: `skill-cli-age-key`
   - Field: `private_key`
3. Encrypt current secrets:
   ```bash
   skill auth encrypt .env.local --recipient <public-key> --output .env.encrypted
   ```
4. Commit `.env.encrypted` to git
5. Create and distribute `~/.op-token` file with service account token

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

### Admin: Initial Setup

1. **Generate keypair:**
   ```bash
   skill auth keygen --json > keypair.json
   ```

2. **Store private key in 1Password:**
   - Vault: `Support` (or your team's shared vault)
   - Item name: `skill-cli-age-key`
   - Add field: `private_key` with value `AGE-SECRET-KEY-1...`
   - Reference becomes: `op://Support/skill-cli-age-key/private_key`

3. **Encrypt secrets:**
   ```bash
   cd packages/cli
   skill auth encrypt .env.local --recipient <public-key> --output .env.encrypted
   ```

4. **Commit encrypted file:**
   ```bash
   git add .env.encrypted
   git commit -m "Add encrypted env for team distribution"
   ```

5. **Create ~/.op-token template:**
   ```bash
   # Create file with service account token
   echo 'export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx..."' > op-token-template.txt
   ```

6. **Distribute token file securely:**
   - Share `op-token-template.txt` via secure channel (1Password itself, secure Slack DM)
   - Team members save as `~/.op-token`

### Team: Zero-Config Setup

1. **Get the token file from admin** (via secure channel)

2. **Save as ~/.op-token:**
   ```bash
   # File should contain:
   export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx..."
   ```

3. **Use the CLI** - that's it:
   ```bash
   skill db-status    # Secrets auto-loaded
   skill front message abc123  # Just works
   ```

### How Auto-Decryption Works

The CLI's env loader (`src/lib/env-loader.ts`) follows this priority:

1. **Local .env.local exists?** → Use it directly (no decryption)
2. **~/.op-token exists?** → Auto-decrypt `.env.encrypted`:
   - Parse token from `~/.op-token`
   - Set `OP_SERVICE_ACCOUNT_TOKEN` in environment
   - Fetch age private key from `op://Support/skill-cli-age-key/private_key`
   - Decrypt `.env.encrypted` on the fly
   - Inject secrets into `process.env`
3. **AGE_SECRET_KEY set?** → Decrypt using that key directly
4. **None of the above?** → Error with clear instructions

## 1Password Service Account Setup

Service accounts enable headless authentication for CLI and team automation.

### Create Service Account

1. **Open 1Password:**
   - Go to Integrations > Service Accounts
   - Click "Create Service Account"
   - Name it: "skill-cli" or "CLI Secrets Distribution"

2. **Configure Access:**
   - Grant read access to the `Support` vault (or wherever age key is stored)
   - Note: Service accounts can't use 2FA or sign in to apps

3. **Generate Token:**
   - Copy the token (`ops_xxx...`)
   - Store it securely (only shown once)

### Create ~/.op-token File

The CLI auto-loads tokens from `~/.op-token` - no shell profile changes needed.

```bash
# Create the token file
cat > ~/.op-token << 'EOF'
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx..."
EOF

# Secure the file
chmod 600 ~/.op-token
```

**Why this file format?**
- Can be sourced manually: `source ~/.op-token`
- Auto-parsed by CLI without sourcing
- Same format works in shell profiles if you prefer that

### Store Age Key in 1Password

1. **Create Item:**
   - Vault: `Support` (must be accessible to service account)
   - Item type: "Secure Note" or "Password"
   - Title: `skill-cli-age-key`

2. **Add Private Key Field:**
   - Add custom field: `private_key`
   - Value: `AGE-SECRET-KEY-1...`

3. **Verify Reference:**
   - Reference: `op://Support/skill-cli-age-key/private_key`
   - Test: `source ~/.op-token && op read "op://Support/skill-cli-age-key/private_key"`

### Troubleshooting 1Password

**"op: command not found"**
- Install 1Password CLI: https://developer.1password.com/docs/cli/get-started/
- Linux: `curl -sS https://downloads.1password.com/linux/keys/1password.asc | sudo gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg`

**CLI not loading secrets automatically**
- Check `~/.op-token` exists and has correct format
- Verify token starts with `ops_`
- Test manually: `source ~/.op-token && op whoami`

**"Failed to read secret from 1Password"**
- Check token has access to vault: `op vault list`
- Verify item exists: `op item get skill-cli-age-key --vault Support`
- Test read directly: `op read "op://Support/skill-cli-age-key/private_key"`

**"No accounts configured for use with 1Password CLI"**
- This means `OP_SERVICE_ACCOUNT_TOKEN` isn't set
- Check `~/.op-token` file exists and is readable
- Verify the token value is correct (single line, no extra quotes)

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

### "Found .env.encrypted but cannot decrypt"

**Cause:** No decryption key available. Neither `~/.op-token` nor `AGE_SECRET_KEY` is configured.

**Fix (recommended - use 1Password):**
1. Get `~/.op-token` file from admin
2. Place at `~/.op-token`
3. Retry the CLI command

**Fix (alternative - manual key):**
```bash
export AGE_SECRET_KEY="AGE-SECRET-KEY-1..."
```

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
export AGE_SECRET_KEY="op://Support/skill-cli-age-key/private_key"
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
# Create ~/.op-token (preferred)
echo 'export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"' > ~/.op-token

# Or export directly
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxx"
```

### "Failed to read secret from 1Password"

**Cause:** Invalid reference, vault access issue, or 1Password CLI not authenticated.

**Fix:**
1. Verify reference format: `op://VaultName/ItemName/FieldName`
2. Test direct read: `source ~/.op-token && op read "op://Support/skill-cli-age-key/private_key"`
3. Check vault access: `op vault list`
4. Verify service account has read access to the vault

### Decryption fails with "bad ciphertext"

**Cause:** Private key doesn't match the public key used for encryption.

**Fix:**
- Verify you're using the correct private key
- Check if key rotation occurred (get new encrypted file)
- Ensure private key wasn't truncated or modified

### "~/.op-token exists but not working"

**Cause:** File format incorrect or token expired.

**Fix:**
1. Check file format:
   ```bash
   cat ~/.op-token
   # Should be: export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
   ```
2. Test token manually:
   ```bash
   source ~/.op-token && op whoami
   ```
3. Get new token from admin if expired

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
