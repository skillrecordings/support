#!/bin/bash
# LLM classification using claude CLI

cd ~/Code/skillrecordings/support/ralph-gold-data

# Export gold conversations
duckdb gold.duckdb -json -c "
  SELECT id, subject, 
         json_extract_string(trigger_message, '\$.body') as body,
         request_type as old_type
  FROM conversations WHERE is_gold = true
" > /tmp/gold_convos.json

TOTAL=$(cat /tmp/gold_convos.json | jq length)
echo "=== Classifying $TOTAL gold conversations with Claude CLI ==="

CATEGORIES="support_access, support_refund, support_transfer, support_technical, support_billing, presales_faq, presales_consult, presales_team, fan_mail, spam, system, voc_response"

for i in $(seq 0 $((TOTAL-1))); do
  ROW=$(jq ".[$i]" /tmp/gold_convos.json)
  ID=$(echo "$ROW" | jq -r '.id')
  SUBJECT=$(echo "$ROW" | jq -r '.subject // "No subject"' | head -c 100)
  BODY=$(echo "$ROW" | jq -r '.body // ""' | head -c 500 | tr '\n' ' ')
  OLD=$(echo "$ROW" | jq -r '.old_type')
  
  echo -n "[$((i+1))/$TOTAL] $ID: $OLD → "
  
  # Call Claude CLI
  PROMPT="Classify this support email into ONE category from: $CATEGORIES

Subject: $SUBJECT
Body: $BODY

Reply with ONLY the category name, nothing else."

  NEW=$(echo "$PROMPT" | claude -p --model claude-3-haiku-[PHONE] 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -d ' \n' | head -c 50)
  
  # Validate category
  case "$NEW" in
    support_access|support_refund|support_transfer|support_technical|support_billing|presales_faq|presales_consult|presales_team|fan_mail|spam|system|voc_response)
      ;;
    *)
      # Try to extract valid category from response
      for cat in support_access support_refund support_transfer support_technical support_billing presales_faq presales_consult presales_team fan_mail spam system voc_response; do
        if echo "$NEW" | grep -q "$cat"; then
          NEW="$cat"
          break
        fi
      done
      # If still not valid, mark unknown
      case "$NEW" in
        support_*|presales_*|fan_mail|spam|system|voc_response) ;;
        *) NEW="unknown" ;;
      esac
      ;;
  esac
  
  echo "$NEW"
  
  # Update DB
  duckdb gold.duckdb -c "UPDATE conversations SET request_type = '$NEW' WHERE id = '$ID'"
  duckdb gold.duckdb -c "UPDATE classifications SET request_type = '$NEW' WHERE conversation_id = '$ID'"
  
  # Small delay
  sleep 0.3
done

echo ""
echo "=== Final Distribution ==="
duckdb gold.duckdb -c "SELECT request_type, COUNT(*) as count FROM conversations WHERE is_gold = true GROUP BY request_type ORDER BY count DESC"

echo ""
echo "=== Changes ==="
duckdb gold.duckdb -c "SELECT request_type, COUNT(*) FROM conversations WHERE is_gold = true AND request_type != 'voc_response' AND request_type != 'unknown' GROUP BY request_type"
