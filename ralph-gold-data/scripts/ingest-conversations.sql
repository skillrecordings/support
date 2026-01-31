-- Load merged conversations into the gold database.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS subject VARCHAR;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_email VARCHAR;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags JSON;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS trigger_message JSON;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS conversation_history JSON;

CREATE OR REPLACE TEMP TABLE _raw_conversations AS
SELECT *
FROM read_json_auto(
  '../packages/cli/data/merged-conversations.json',
  maximum_object_size = [PHONE]
);

INSERT INTO products (id, name, has_self_serve)
SELECT DISTINCT source AS id, source AS name, FALSE AS has_self_serve
FROM _raw_conversations
WHERE source NOT IN (SELECT id FROM products);

INSERT INTO conversations (
  id,
  subject,
  customer_email,
  product,
  request_type,
  quality_score,
  is_gold,
  tags,
  trigger_message,
  conversation_history,
  raw_json
)
SELECT
  id,
  subject,
  customerEmail AS customer_email,
  source AS product,
  'unknown' AS request_type,
  0.0 AS quality_score,
  FALSE AS is_gold,
  to_json(tags) AS tags,
  to_json(triggerMessage) AS trigger_message,
  to_json(conversationHistory) AS conversation_history,
  NULL AS raw_json
FROM (
  SELECT
    *,
    row_number() OVER (PARTITION BY conversationId ORDER BY id) AS rn
  FROM _raw_conversations
) deduped
WHERE rn = 1;
