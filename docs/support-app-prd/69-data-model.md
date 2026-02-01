# Data Model

```sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,

  front_inbox_id TEXT NOT NULL,

  stripe_account_id TEXT,
  stripe_connected BOOLEAN DEFAULT FALSE,

  integration_base_url TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  capabilities TEXT[] NOT NULL,

  auto_approve_refund_days INTEGER DEFAULT 30,
  auto_approve_transfer_days INTEGER DEFAULT 14,
  escalation_slack_channel TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  front_conversation_id TEXT UNIQUE NOT NULL,
  app_id TEXT REFERENCES apps(id),

  customer_email TEXT NOT NULL,
  customer_name TEXT,

  status TEXT DEFAULT 'open',
  assigned_to TEXT,

  last_agent_run_id TEXT,
  last_agent_action TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  app_id TEXT REFERENCES apps(id),

  type TEXT NOT NULL,
  parameters JSONB NOT NULL,

  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by TEXT,
  approved_at TIMESTAMP,
  rejected_by TEXT,
  rejected_at TIMESTAMP,
  rejection_reason TEXT,

  executed_at TIMESTAMP,
  result JSONB,
  error TEXT,

  trace_id TEXT,
  langfuse_trace_id TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  action_id TEXT REFERENCES actions(id),

  slack_message_ts TEXT,
  slack_channel TEXT,

  status TEXT DEFAULT 'pending',

  agent_reasoning TEXT,

  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Response tracking data flow

- Draft content is stored on the `actions` row under `parameters.draft` (legacy `parameters.response` for the older `draft-response` action type). Some records may nest the text under `parameters.draft.content` or `parameters.response.text`.
- Customer identity comes from `conversations.customer_email`/`customer_name` when available, with fallbacks to `actions.parameters.senderEmail`, `actions.parameters.context.customerEmail`, or `actions.parameters.(context|gatheredContext).customer.email` for older records.
- Classification metadata is available in `actions.category` (preferred) or `actions.parameters.category`/`actions.parameters.context.category` for older records.
