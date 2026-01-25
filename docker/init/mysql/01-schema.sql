-- Support Eval Environment Schema
-- Generated from packages/database/src/schema.ts

-- Apps registry
CREATE TABLE IF NOT EXISTS SUPPORT_apps (
  id VARCHAR(255) PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  
  front_inbox_id VARCHAR(255) NOT NULL,
  instructor_teammate_id VARCHAR(255),
  
  stripe_account_id VARCHAR(255),
  stripe_connected BOOLEAN DEFAULT FALSE,
  
  integration_base_url TEXT NOT NULL,
  webhook_secret VARCHAR(255) NOT NULL,
  capabilities JSON NOT NULL,
  
  auto_approve_refund_days INT DEFAULT 30,
  auto_approve_transfer_days INT DEFAULT 14,
  escalation_slack_channel VARCHAR(255),
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Conversations tracking
CREATE TABLE IF NOT EXISTS SUPPORT_conversations (
  id VARCHAR(255) PRIMARY KEY,
  front_conversation_id VARCHAR(255) NOT NULL UNIQUE,
  app_id VARCHAR(255),
  
  customer_email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255),
  
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  assigned_to VARCHAR(255),
  
  last_agent_run_id VARCHAR(255),
  last_agent_action TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_app_id (app_id),
  INDEX idx_customer_email (customer_email),
  INDEX idx_status (status)
);

-- Agent actions with approval workflow
CREATE TABLE IF NOT EXISTS SUPPORT_actions (
  id VARCHAR(255) PRIMARY KEY,
  conversation_id VARCHAR(255),
  app_id VARCHAR(255),
  
  type VARCHAR(255) NOT NULL,
  parameters JSON NOT NULL,
  
  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by VARCHAR(255),
  approved_at DATETIME,
  rejected_by VARCHAR(255),
  rejected_at DATETIME,
  rejection_reason TEXT,
  
  executed_at DATETIME,
  result JSON,
  error TEXT,
  
  trace_id VARCHAR(255),
  langfuse_trace_id VARCHAR(255),
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_conversation_id (conversation_id),
  INDEX idx_app_id (app_id),
  INDEX idx_type (type)
);

-- Approval requests
CREATE TABLE IF NOT EXISTS SUPPORT_approval_requests (
  id VARCHAR(255) PRIMARY KEY,
  action_id VARCHAR(255),
  
  slack_message_ts VARCHAR(255),
  slack_channel VARCHAR(255),
  
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  
  agent_reasoning TEXT,
  
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_action_id (action_id),
  INDEX idx_status (status)
);

-- Audit log for observability
CREATE TABLE IF NOT EXISTS SUPPORT_audit_log (
  id VARCHAR(255) PRIMARY KEY,
  conversation_id VARCHAR(255),
  app_id VARCHAR(255),
  
  action_type VARCHAR(50) NOT NULL,
  
  tool_name VARCHAR(255),
  parameters JSON NOT NULL,
  result JSON,
  error TEXT,
  
  duration_ms INT,
  token_usage JSON,
  
  trace_id VARCHAR(255),
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_conversation_id (conversation_id),
  INDEX idx_app_id (app_id),
  INDEX idx_action_type (action_type)
);

-- Trust scores for auto-send
CREATE TABLE IF NOT EXISTS SUPPORT_trust_scores (
  id VARCHAR(255) PRIMARY KEY,
  app_id VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  
  trust_score DOUBLE NOT NULL DEFAULT 0.5,
  sample_count INT NOT NULL DEFAULT 0,
  
  decay_half_life_days INT NOT NULL DEFAULT 30,
  
  last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_app_category (app_id, category),
  INDEX idx_app_id (app_id)
);

-- Dead letter queue
CREATE TABLE IF NOT EXISTS SUPPORT_dead_letter_queue (
  id VARCHAR(255) PRIMARY KEY,
  event_name VARCHAR(255) NOT NULL,
  event_data JSON NOT NULL,
  
  error_message TEXT NOT NULL,
  error_stack TEXT,
  
  retry_count INT NOT NULL DEFAULT 0,
  consecutive_failures INT NOT NULL DEFAULT 1,
  
  first_failed_at DATETIME NOT NULL,
  last_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  alerted_at DATETIME,
  resolved_at DATETIME,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_event_name (event_name),
  INDEX idx_resolved_at (resolved_at)
);
