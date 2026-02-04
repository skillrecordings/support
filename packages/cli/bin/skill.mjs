#!/usr/bin/env bun

// Load secrets via 1Password/age encryption before importing CLI
// This sets DATABASE_URL and other env vars from encrypted .env.encrypted
await import('../dist/preload.js')

// Now import the main CLI with secrets available
await import('../dist/index.js')
