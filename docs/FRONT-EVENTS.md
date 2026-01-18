# Front Webhook Events

Reference for Front webhook event types and payload structure.

## Application Webhook Event Types

| Webhook Event Type | API Event Type | Description |
|-------------------|----------------|-------------|
| `inbound_received` | `inbound` | Incoming message received |
| `outbound_sent` | `outbound` | Outbound message sent |
| `conversation_archived` | `archive` | Conversation archived |
| `conversation_reopened` | `reopen` | Conversation unarchived |
| `conversation_deleted` | `trash` | Conversation deleted |
| `conversation_restored` | `restore` | Conversation restored from trash |
| `conversation_snoozed` | - | Conversation snoozed |
| `conversation_snooze_expired` | `reminder` | Snooze expired |
| `new_comment_added` | `comment` | Teammate commented |
| `assignee_changed` | `assign`/`unassign` | Assignee changed |
| `tag_added` | `tag` | Tag added |
| `tag_removed` | `untag` | Tag removed |
| `link_added` | `link_added` | Link added |
| `link_removed` | `link_removed` | Link removed |
| `message_delivery_failed` | `sending_error` | Message delivery failed |
| `conversation_moved` | `move` | Conversation moved |

## Webhook Payload Structure

Application webhooks wrap the event in an envelope:

```typescript
interface FrontWebhookPayload {
  // Webhook event type (inbound_received, outbound_sent, etc.)
  type: string

  // Company/workspace info
  authorization: {
    id: string // e.g., "cmp_abc"
  }

  // The actual event object (PREVIEW ONLY)
  payload: FrontEventPreview
}
```

## Event Preview vs Full Event

**IMPORTANT**: Webhooks send event PREVIEWS, not full data.

Preview contains:
- IDs for conversation, message, etc.
- `_links` to fetch full data
- Basic metadata

Preview does NOT contain:
- Full message body
- Author email address
- Full conversation history

### Fetching Full Data

Use the `_links` in the preview to fetch full data via Front API:

```typescript
// From webhook preview
const messageLink = event.payload.target.data._links.self
// e.g., "https://api2.frontapp.com/messages/msg_abc123"

// Fetch full message
const response = await fetch(messageLink, {
  headers: { Authorization: `Bearer ${FRONT_API_TOKEN}` }
})
const fullMessage = await response.json()
```

## Event Object Structure

```typescript
interface FrontEventPreview {
  id: string           // e.g., "evt_55c8c149"
  type: string         // API event type (inbound, outbound, assign, etc.)
  emitted_at: number   // Unix timestamp

  // Conversation preview
  conversation: {
    id: string
    subject: string
    _links: {
      self: string
      related: {
        messages: string
      }
    }
  }

  // Target preview (message for inbound/outbound)
  target: {
    _meta: { type: string }  // "message", "teammate", etc.
    data: {
      id: string
      _links: { self: string }
    }
  }

  // Source preview
  source: {
    _meta: { type: string }  // "inboxes", "teammate", etc.
    data: {
      id: string
    }
  }
}
```

## See Also

- [Front Webhooks Overview](https://dev.frontapp.com/docs/webhooks-1)
- [Application Webhooks](https://dev.frontapp.com/docs/application-webhooks)
- [Events API](https://dev.frontapp.com/docs/events)
