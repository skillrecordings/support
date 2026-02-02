#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const TEMPLATES_DIR = path.join(process.cwd(), 'templates')

// Templates to create variations for
const TEMPLATES = [
  'apology-confusion',
  'check-spam-folder',
  'closing-friendly',
  'greeting-apologetic',
  'invoice-ready',
  'license-transferred',
  'login-link-sent',
  'login-link-troubleshoot',
  'refund-initiated',
  'troubleshoot-relogin'
]

// Formal transformations
const FORMAL_TRANSFORMS: Record<string, string> = {
  // Default template content -> formal version
  'apology-confusion': `I apologize for any confusion this may have caused. Please allow me to clarify the situation for you.`,
  'check-spam-folder': `Please check your spam or junk mail folder, as our messages may occasionally be filtered there. If you locate the email, kindly mark it as "not spam" to ensure future correspondence reaches your inbox.`,
  'closing-friendly': `If you have any additional questions or require further assistance, please do not hesitate to reach out. We are here to help.

Best regards,
The Support Team`,
  'greeting-apologetic': `Thank you for contacting us, and I sincerely apologize for any inconvenience you have experienced.`,
  'invoice-ready': `Your invoice has been prepared and is attached to this correspondence. Please review it at your earliest convenience and let us know if you require any modifications.`,
  'license-transferred': `Your license has been successfully transferred to the new account. The recipient should now have full access to all associated materials.`,
  'login-link-sent': `A secure login link has been sent to your registered email address. Please note that this link will expire in 24 hours for security purposes.`,
  'login-link-troubleshoot': `If you are experiencing difficulties with the login link, please try the following steps:
1. Ensure you are using the most recent link sent to your email
2. Clear your browser cache and cookies
3. Try using an incognito/private browsing window
4. Verify that you are using a supported browser`,
  'refund-initiated': `Your refund has been processed and submitted to your financial institution. Please allow 5-10 business days for the funds to appear in your account, as processing times vary by bank.`,
  'troubleshoot-relogin': `Please try signing out and then signing back in to refresh your session. This often resolves access issues. If the problem persists, please clear your browser cache and attempt again.`
}

// Brief transformations
const BRIEF_TRANSFORMS: Record<string, string> = {
  'apology-confusion': `Sorry for the confusion! Let me clarify.`,
  'check-spam-folder': `Check spam/junk folder. Mark as "not spam" if found.`,
  'closing-friendly': `Questions? Just reply. Happy to help!`,
  'greeting-apologetic': `Sorry for the trouble!`,
  'invoice-ready': `Invoice attached. Let me know if changes needed.`,
  'license-transferred': `License transferred. New account has access now.`,
  'login-link-sent': `Login link sent to your email (expires in 24h).`,
  'login-link-troubleshoot': `Link not working? Try:
- Use latest link
- Clear cache
- Try incognito mode`,
  'refund-initiated': `Refund processed. 5-10 business days to appear.`,
  'troubleshoot-relogin': `Try signing out and back in. Still stuck? Clear browser cache.`
}

async function main() {
  console.log('=== Creating Template Variations ===\n')
  
  let formalCreated = 0
  let briefCreated = 0
  
  for (const name of TEMPLATES) {
    console.log(`Processing: ${name}`)
    
    // Create formal version
    const formalPath = path.join(TEMPLATES_DIR, `${name}-formal.md`)
    const formalContent = FORMAL_TRANSFORMS[name] || ''
    if (formalContent) {
      await fs.writeFile(formalPath, formalContent)
      console.log(`  - Created ${name}-formal.md`)
      formalCreated++
    }
    
    // Create brief version
    const briefPath = path.join(TEMPLATES_DIR, `${name}-brief.md`)
    const briefContent = BRIEF_TRANSFORMS[name] || ''
    if (briefContent) {
      await fs.writeFile(briefPath, briefContent)
      console.log(`  - Created ${name}-brief.md`)
      briefCreated++
    }
  }
  
  // Update index.md
  const indexPath = path.join(TEMPLATES_DIR, 'index.md')
  const indexContent = `# Response Templates

This directory contains reusable response templates with variations for different tones.

## Template Variations

Each template has three versions:
- **Default** (e.g., \`refund-initiated.md\`) - Balanced, friendly tone
- **Formal** (e.g., \`refund-initiated-formal.md\`) - Professional, corporate tone
- **Brief** (e.g., \`refund-initiated-brief.md\`) - Minimal, just the facts

## Available Templates

| Template | Description | Variations |
|----------|-------------|------------|
${TEMPLATES.map(t => `| ${t} | ${t.replace(/-/g, ' ')} | default, formal, brief |`).join('\n')}

## Usage

Import templates based on customer context:
- Use **formal** for corporate/enterprise customers
- Use **brief** for quick follow-ups or chat
- Use **default** for standard email responses

Generated: ${new Date().toISOString()}
`
  
  await fs.writeFile(indexPath, indexContent)
  console.log(`\nUpdated index.md`)
  
  console.log(`\n=== Done ===`)
  console.log(`Created ${formalCreated} formal templates`)
  console.log(`Created ${briefCreated} brief templates`)
}

main().catch(console.error)
