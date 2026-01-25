# Front Message Template Conventions

Guide for creating, organizing, and maintaining message templates.

## Naming Conventions

Templates should follow this naming pattern:
`[Product] - [Category] - [Specific Action]`

**Examples:**
- `TT - Refund - Approved Within Policy`
- `TT - Access - Password Reset Instructions`
- `Epic Web - Invoice - Duplicate Request`
- `Shared - General - Out of Office`

**Categories:**
- **Refund** - All refund-related responses
- **Access** - Login, password, account access
- **Invoice** - Billing, receipts, invoices
- **License** - License transfers, team seats
- **Technical** - Bug reports, technical issues
- **General** - Greetings, acknowledgments, OOO

## Folder Structure

```
/TotalTypeScript    - TT-specific templates
/EpicWeb            - Epic Web templates
/EpicReact          - Epic React templates  
/ProTailwind        - Pro Tailwind templates
/Shared             - Cross-product templates
```

**When to use Shared:**
- Generic acknowledgments
- Out of office responses
- Universal policies that apply to all products

## Inbox Scoping

Templates can be scoped to specific inboxes via the Front API:
- **Scoped**: Only visible in specified inbox(es) - use `inbox_ids` parameter
- **Global**: Visible in all inboxes (use sparingly)

**Best practice:** Always scope product-specific templates to their inbox. This keeps the template picker clean and reduces confusion when agents switch between inboxes.

## Variable Usage

Standard variables (Front's built-in):
- `{{contact.name}}` - Customer's name
- `{{contact.email}}` - Customer's email

Custom variables (define in template):
- `{{product_name}}` - Product being discussed
- `{{amount}}` - Refund/purchase amount
- `{{purchase_date}}` - When they purchased

**Example:**
```
Hi {{contact.name}},

Your refund of {{amount}} for {{product_name}} has been processed...
```

## When to Create vs Reuse

**Create a new template when:**
- You've written the same response 3+ times
- The response is >50 words and follows a pattern
- Multiple team members need to send similar responses

**Reuse existing templates when:**
- A template exists that's 80%+ what you need
- Minor customization is sufficient
- The core message is the same

## Tone & Formatting

### Greeting
- Use `Hi {{contact.name}},` (friendly, personal)
- Avoid `Dear Customer` (too formal)

### Sign-off
- `Best,` or `Thanks,` followed by team name
- Include relevant links (Discord, docs)

### Formatting
- Keep paragraphs short (2-3 sentences max)
- Use bullet points for lists
- Bold key actions: **click here**, **your refund**
- Include one clear call-to-action

## Maintenance

- Review templates quarterly for outdated content
- Archive unused templates (no usage in 90 days)
- Update pricing/links when products change
- Test variables before saving

## API Reference

Templates can be managed programmatically via the Front SDK:

```typescript
// List templates for an inbox
const templates = await frontClient.messageTemplates.list(inboxId)

// Create a scoped template
await frontClient.messageTemplates.create(inboxId, {
  name: 'TT - Refund - Approved',
  subject: 'Your refund has been processed',
  body: 'Hi {{contact.name}}...',
  inbox_ids: [inboxId]  // Scope to specific inbox
})
```

See [Front API docs](https://dev.frontapp.com/reference/message-templates) for full details.
