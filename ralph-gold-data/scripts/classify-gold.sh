#!/bin/bash
# Simple LLM classification using curl to Anthropic API

cd ~/Code/skillrecordings/support/ralph-gold-data

API_KEY="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"

# Export gold conversations
duckdb gold.duckdb -json -c "
  SELECT id, subject, 
         json_extract_string(trigger_message, '\$.body') as body,
         request_type as old_type
  FROM conversations WHERE is_gold = true
" > /tmp/gold_convos.json

TOTAL=$(cat /tmp/gold_convos.json | jq length)
echo "=== Classifying $TOTAL gold conversations ==="

# Process each
for i in $(seq 0 $((TOTAL-1))); do
  ROW=$(jq ".[$i]" /tmp/gold_convos.json)
  ID=$(echo "$ROW" | jq -r '.id')
  SUBJECT=$(echo "$ROW" | jq -r '.subject // "No subject"' | head -c 100)
  BODY=$(echo "$ROW" | jq -r '.body // ""' | head -c 800)
  OLD=$(echo "$ROW" | jq -r '.old_type')
  
  echo -n "[$((i+1))/$TOTAL] $ID: $OLD → "
  
  # Call Claude
  RESPONSE=$(curl -s https://api.anthropic.com/v1/messages \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d "{
      \"model\": \"claude-3-haiku-[PHONE]\",
      \"max_tokens\": 50,
      \"messages\": [{
        \"role\": \"user\",
        \"content\": \"Classify this support email into ONE category: support_access, support_refund, support_transfer, support_technical, support_billing, presales_faq, presales_consult, presales_team, fan_mail, spam, system, voc_response.\\n\\nSubject: $SUBJECT\\nBody: $BODY\\n\\nReply with ONLY the category name.\"
      }]
    }")
  
  NEW=$(echo "$RESPONSE" | jq -r '.content[0].text // "error"' | tr '[:upper:]' '[:lower:]' | tr -d ' \n')
  
  # Validate category
  case "$NEW" in
    support_access|support_refund|support_transfer|support_technical|support_billing|presales_faq|presales_consult|presales_team|fan_mail|spam|system|voc_response)
      ;;
    *)
      NEW="unknown"
      ;;
  esac
  
  echo "$NEW"
  
  # Update DB
  duckdb gold.duckdb -c "UPDATE conversations SET request_type = '$NEW' WHERE id = '$ID'"
  duckdb gold.duckdb -c "UPDATE classifications SET request_type = '$NEW' WHERE conversation_id = '$ID'"
  
  # Rate limit
  sleep 0.5
done

echo ""
echo "=== Final Distribution ==="
duckdb gold.duckdb -c "SELECT request_type, COUNT(*) as count FROM conversations WHERE is_gold = true GROUP BY request_type ORDER BY count DESC"
