---
name: front-api
description: Front REST API reference for server-side operations. Use when working with Front API client, fetching conversations, creating drafts, managing templates, or any backend Front integration.
---

# Front REST API

Server-side REST API for Front integrations. Base URL: `https://api2.frontapp.com`

## When to Use This Skill

- Implementing Front API client methods
- Creating/updating drafts via API
- Fetching conversation/message data
- Managing message templates
- Working with tags, contacts, inboxes

## Authentication

Bearer token in Authorization header:

```ts
const headers = {
  Authorization: `Bearer ${FRONT_API_TOKEN}`,
  'Content-Type': 'application/json'
}
```

## Our Client

We have a typed Front client at `packages/core/src/front/client.ts`:

```ts
import { createFrontClient } from '@skillrecordings/core/front'

const front = createFrontClient(process.env.FRONT_API_TOKEN)

// Get conversation
const conv = await front.getConversation('cnv_xxx')

// Get messages
const messages = await front.getConversationMessages('cnv_xxx')

// Create draft
await front.createDraft(conversationId, body, channelId, { authorId, signatureId })
```

## Key Endpoints We Use

### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations/{id}` | Fetch conversation |
| GET | `/conversations/{id}/messages` | List messages |
| GET | `/conversations/{id}/inboxes` | Get inboxes |
| POST | `/conversations/{id}/drafts` | Create draft reply |
| POST | `/conversations/{id}/messages` | Send reply (immediate) |
| POST | `/conversations/{id}/tags` | Add tags |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/messages/{id}` | Fetch message |

### Drafts

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/conversations/{id}/drafts` | Create draft in conversation |
| POST | `/channels/{id}/drafts` | Create new draft (not reply) |
| PATCH | `/drafts/{id}` | Update draft |
| DELETE | `/drafts/{id}` | Delete draft |

### Message Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/message_templates` | List all templates |
| GET | `/message_template_folders` | List folders |
| GET | `/message_templates/{id}` | Get template |
| POST | `/message_templates` | Create template |
| POST | `/inboxes/{id}/message_templates` | Create inbox template |
| PATCH | `/message_templates/{id}` | Update template |
| DELETE | `/message_templates/{id}` | Delete template |

### Inboxes & Channels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/inboxes` | List inboxes |
| GET | `/inboxes/{id}` | Get inbox |
| GET | `/inboxes/{id}/channels` | List channels |
| GET | `/channels/{id}` | Get channel |

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tags` | List tags |
| POST | `/tags` | Create tag |
| GET | `/tags/{id}` | Get tag |

### Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/contacts` | List contacts |
| GET | `/contacts/{id}` | Get contact |
| POST | `/contacts` | Create contact |

## Related Skills

- `front-webhook` - Handling incoming webhooks from Front
- `front-plugin` - Building UI plugins with Plugin SDK

## Detailed Reference

See `rules/` for:
- Request/response schemas
- Pagination patterns
- Error handling
- Template management
