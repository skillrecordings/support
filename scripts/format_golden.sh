#!/bin/bash
# Format golden responses into final artifact format

cd ~/Code/skillrecordings/support
OUTPUT_DIR="artifacts/phase-0/golden/v1"

# Create responses.json with proper format
cat "$OUTPUT_DIR/raw_responses.json" | jq '
  . as $all |
  {
    responses: [
      .[] | . as $r | {
        id: ("gr_" + (($all | index($r)) + 1 | tostring | if length == 1 then "00" + . elif length == 2 then "0" + . else . end)),
        text: .response,
        template: (
          .response
          | gsub("(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})"; "{email}")
          | gsub("\\$[0-9]+(\\.[0-9]{2})?"; "{amount}")
        ),
        reuse_count: .reuse_count,
        avg_thread_length: .avg_thread_length,
        source_conversations: .conversation_ids,
        quality_score: .quality_score,
        text_length: .text_length,
        topic: (
          if (.response | test("refund"; "i")) then "refund"
          elif (.response | test("transfer|move.*email|change.*email"; "i")) then "transfer"
          elif (.response | test("invoice|receipt"; "i")) then "invoice"
          elif (.response | test("discord|community"; "i")) then "community"
          elif (.response | test("download|video|zip"; "i")) then "download"
          elif (.response | test("license|seat|team"; "i")) then "license"
          elif (.response | test("coupon|discount|ppp"; "i")) then "discount"
          elif (.response | test("access|login|password"; "i")) then "access"
          else "general"
          end
        )
      }
    ],
    total_golden: length,
    total_analyzed: length
  }
' > "$OUTPUT_DIR/responses.json"

echo "Created responses.json with $(cat $OUTPUT_DIR/responses.json | jq '.total_golden') golden responses"

# Create templates.json - group by topic
cat "$OUTPUT_DIR/responses.json" | jq '
  .responses 
  | group_by(.topic) 
  | map({
      id: ("tpl_" + (. | .[0].topic)),
      template: .[0].template,
      variations: [.[].id],
      topic: .[0].topic,
      usage_count: (map(.reuse_count) | add)
    })
  | sort_by(-.usage_count)
  | {templates: .}
' > "$OUTPUT_DIR/templates.json"

echo "Created templates.json with $(cat $OUTPUT_DIR/templates.json | jq '.templates | length') templates"

# Create stats.json
cat "$OUTPUT_DIR/responses.json" | jq '
  {
    total_analyzed: .total_analyzed,
    total_golden: .total_golden,
    total_templates: ((.responses | group_by(.topic) | length)),
    avg_quality_score: ((.responses | map(.quality_score) | add) / .total_golden | . * 1000 | round / 1000),
    avg_reuse_count: ((.responses | map(.reuse_count) | add) / .total_golden | round),
    topic_distribution: (.responses | group_by(.topic) | map({key: .[0].topic, value: length}) | from_entries),
    quality_distribution: {
      high: ([.responses[] | select(.quality_score >= 0.7)] | length),
      medium: ([.responses[] | select(.quality_score >= 0.4 and .quality_score < 0.7)] | length),
      low: ([.responses[] | select(.quality_score < 0.4)] | length)
    },
    extraction_params: {
      min_reuse_count: 3,
      min_text_length: 100,
      max_thread_length: 10,
      boilerplate_filtered: true,
      autoresponder_filtered: true
    }
  }
' > "$OUTPUT_DIR/stats.json"

echo "Created stats.json"
cat "$OUTPUT_DIR/stats.json" | jq '.'
