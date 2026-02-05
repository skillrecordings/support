# Task Handoff: Add LINEAR_API_KEY to Encrypted Env

## Status: BLOCKED
**Blocker:** LINEAR_API_KEY doesn't exist in 1Password

## What I Completed
1. ✅ Installed age encryption tool
2. ✅ Successfully decrypted .env.encrypted
3. ✅ Verified encryption/decryption workflow
4. ✅ Analyzed secret-refs.ts pattern
5. ✅ Stored hivemind learning about age decryption process

## What's Blocked
Cannot add LINEAR_API_KEY because it doesn't exist in 1Password:
- No item "skill-cli" in Support vault
- No LINEAR_API_KEY in any vault
- Path 'op://Support/skill-cli/LINEAR_API_KEY' is invalid

## To Unblock
Create LINEAR_API_KEY in 1Password. Options:

**Option 1: Create new item**
```bash
# Create Linear API key in Linear dashboard first
# Then store in 1Password:
op item create --vault=Support --category=password \
  --title="skill-cli" \
  LINEAR_API_KEY[password]="lin_api_xxx"
```

**Option 2: Add to existing item**
```bash
# If there's already a skill-cli item elsewhere:
op item edit <item-id> LINEAR_API_KEY[password]="lin_api_xxx"
```

## Once Unblocked - Complete Steps

1. **Get keys:**
```bash
PRIVATE_KEY=$(op read 'op://Support/skill-cli-age-key/private_key')
PUBLIC_KEY=$(op read 'op://Support/skill-cli-age-key/public_key')
LINEAR_KEY=$(op read 'op://Support/skill-cli/LINEAR_API_KEY')
```

2. **Decrypt current env:**
```bash
cd packages/cli
echo "$PRIVATE_KEY" > /tmp/age-key.txt
age -d -i /tmp/age-key.txt .env.encrypted > .env.decrypted
```

3. **Add LINEAR_API_KEY:**
```bash
echo "LINEAR_API_KEY=\"$LINEAR_KEY\"" >> .env.decrypted
```

4. **Re-encrypt:**
```bash
echo "$PUBLIC_KEY" > /tmp/age-pub.txt
age -r "$(cat /tmp/age-pub.txt)" -o .env.encrypted .env.decrypted
rm /tmp/age-key.txt /tmp/age-pub.txt .env.decrypted
```

5. **Update secret-refs.ts:**
```typescript
// Add after line 30:
LINEAR_API_KEY: 'op://Support/skill-cli/LINEAR_API_KEY',
```

6. **Verify:**
```bash
# Test decryption works
op read 'op://Support/skill-cli-age-key/private_key' > /tmp/key.txt
age -d -i /tmp/key.txt .env.encrypted | grep LINEAR_API_KEY
rm /tmp/key.txt
```

## Files to Modify
- `packages/cli/.env.encrypted` - Add LINEAR_API_KEY (re-encrypt)
- `packages/cli/src/core/secret-refs.ts` - Add reference (line 31)

## Notes
- Age encryption working correctly
- Existing .env.encrypted has 20+ secrets properly encrypted
- Pattern matches other secrets in file
- secret-refs.ts pattern is straightforward const object
