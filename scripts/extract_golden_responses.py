#!/usr/bin/env python3
"""Extract golden responses from Front support conversations."""

import json
import re
import hashlib
from pathlib import Path
from collections import defaultdict
import duckdb

# Paths
DB_PATH = Path.home() / "skill/data/front-cache.db"
OUTPUT_DIR = Path.home() / "Code/skillrecordings/support/artifacts/phase-0/golden/v1"

# Boilerplate patterns to filter
BOILERPLATE_PATTERNS = [
    r"^thanks!?\s*$",
    r"^thank you!?\s*$",
    r"^ok!?\s*$",
    r"^okay!?\s*$",
    r"^great!?\s*$",
    r"^perfect!?\s*$",
    r"^awesome!?\s*$",
    r"^sounds good!?\s*$",
    r"^got it!?\s*$",
    r"We work normal business hours",  # Autoresponder
    r"^hi 👋,?\s*\n+\s*we work normal business",  # Full autoresponder
    r"If you email outside of those times",  # Autoresponder variant
]

# PII patterns to generalize
PII_PATTERNS = [
    (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "{email}"),
    (r"\b(?:https?://)?(?:www\.)?[a-zA-Z0-9-]+\.(?:com|dev|io|net|org)/[^\s]*", "{url}"),
    (r"\$\d+(?:\.\d{2})?", "{amount}"),
    (r"\b\d{4}[-/]\d{2}[-/]\d{2}\b", "{date}"),
]

def is_boilerplate(text: str) -> bool:
    """Check if response is boilerplate."""
    text_lower = text.lower().strip()
    for pattern in BOILERPLATE_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE | re.MULTILINE):
            return True
    # Too short
    if len(text.strip()) < 100:
        return True
    return False

def extract_template(text: str) -> str:
    """Convert specific response to generalized template."""
    template = text
    for pattern, replacement in PII_PATTERNS:
        template = re.sub(pattern, replacement, template)
    return template

def compute_quality_score(reuse_count: int, avg_thread_length: float, text_length: int) -> float:
    """Compute quality score (0-1) for a response."""
    # Normalize factors
    reuse_score = min(reuse_count / 50, 1.0)  # Cap at 50 reuses
    length_score = min(text_length / 500, 1.0)  # Cap at 500 chars
    resolution_score = max(0, 1 - (avg_thread_length - 2) / 5)  # 2 msgs = 1.0, 7+ msgs = 0
    
    # Weighted combination
    return 0.4 * reuse_score + 0.3 * resolution_score + 0.3 * length_score

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    conn = duckdb.connect(str(DB_PATH), read_only=True)
    
    # Query for reused responses
    query = """
    WITH thread_counts AS (
      SELECT conversation_id, COUNT(*) as msg_count 
      FROM messages GROUP BY conversation_id
    )
    SELECT 
      m.body_text as response,
      COUNT(DISTINCT c.id) as reuse_count,
      AVG(thread.msg_count) as avg_thread_length,
      list(DISTINCT c.id) as conversation_ids,
      list(DISTINCT unnest(c.tags)) as all_tags
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id
    JOIN thread_counts thread ON thread.conversation_id = c.id
    WHERE c.status = 'archived'
      AND m.is_inbound = false
      AND thread.msg_count BETWEEN 2 AND 10
      AND LENGTH(m.body_text) > 50
    GROUP BY m.body_text
    HAVING COUNT(DISTINCT c.id) >= 3
    ORDER BY reuse_count DESC
    """
    
    results = conn.execute(query).fetchall()
    print(f"Found {len(results)} raw golden response candidates")
    
    # Process and filter
    golden_responses = []
    template_groups = defaultdict(list)  # template -> [response_ids]
    total_analyzed = len(results)
    
    for i, (response, reuse_count, avg_thread_length, conv_ids, tags) in enumerate(results):
        if response is None or is_boilerplate(response):
            continue
        
        response_id = f"gr_{i+1:03d}"
        template = extract_template(response)
        quality_score = compute_quality_score(reuse_count, avg_thread_length, len(response))
        
        # Limit conversation IDs to first 20 for storage
        conv_list = conv_ids[:20] if conv_ids else []
        tag_list = [t for t in (tags or []) if t] [:10]  # First 10 non-null tags
        
        golden_response = {
            "id": response_id,
            "text": response[:2000],  # Truncate for storage
            "template": template[:2000],
            "reuse_count": reuse_count,
            "avg_thread_length": round(avg_thread_length, 2),
            "source_conversations": conv_list,
            "associated_tags": tag_list,
            "quality_score": round(quality_score, 3),
            "text_length": len(response)
        }
        golden_responses.append(golden_response)
        
        # Group by template for template extraction
        template_hash = hashlib.md5(template.encode()).hexdigest()[:12]
        template_groups[template_hash].append({
            "id": response_id,
            "template": template,
            "usage_count": reuse_count
        })
    
    # Sort by quality score
    golden_responses.sort(key=lambda x: x["quality_score"], reverse=True)
    
    print(f"After filtering: {len(golden_responses)} golden responses")
    
    # Extract templates (groups with 2+ similar responses or high usage)
    templates = []
    for i, (hash_id, group) in enumerate(sorted(template_groups.items(), 
                                                  key=lambda x: sum(r["usage_count"] for r in x[1]), 
                                                  reverse=True)):
        if len(group) >= 1:  # Include singles with high usage
            total_usage = sum(r["usage_count"] for r in group)
            if total_usage >= 5 or len(group) >= 2:
                # Extract topic from template
                template_text = group[0]["template"]
                topic = extract_topic(template_text)
                
                templates.append({
                    "id": f"tpl_{i+1:03d}",
                    "template": template_text[:1500],
                    "variations": [r["id"] for r in group],
                    "topic": topic,
                    "usage_count": total_usage
                })
    
    templates = templates[:100]  # Top 100 templates
    print(f"Extracted {len(templates)} templates")
    
    # Generate stats
    stats = {
        "total_analyzed": total_analyzed,
        "total_golden": len(golden_responses),
        "total_templates": len(templates),
        "avg_quality_score": round(sum(r["quality_score"] for r in golden_responses) / max(len(golden_responses), 1), 3),
        "avg_reuse_count": round(sum(r["reuse_count"] for r in golden_responses) / max(len(golden_responses), 1), 1),
        "top_tags": get_top_tags(golden_responses),
        "quality_distribution": {
            "high": len([r for r in golden_responses if r["quality_score"] >= 0.7]),
            "medium": len([r for r in golden_responses if 0.4 <= r["quality_score"] < 0.7]),
            "low": len([r for r in golden_responses if r["quality_score"] < 0.4])
        },
        "extraction_params": {
            "min_reuse_count": 3,
            "min_text_length": 50,
            "max_thread_length": 10,
            "boilerplate_filtered": True
        }
    }
    
    # Write outputs
    with open(OUTPUT_DIR / "responses.json", "w") as f:
        json.dump({
            "responses": golden_responses,
            "total_golden": len(golden_responses),
            "total_analyzed": total_analyzed
        }, f, indent=2)
    
    with open(OUTPUT_DIR / "templates.json", "w") as f:
        json.dump({"templates": templates}, f, indent=2)
    
    with open(OUTPUT_DIR / "stats.json", "w") as f:
        json.dump(stats, f, indent=2)
    
    print(f"\nOutputs written to {OUTPUT_DIR}")
    print(f"  - responses.json: {len(golden_responses)} golden responses")
    print(f"  - templates.json: {len(templates)} templates")
    print(f"  - stats.json: extraction statistics")
    
    # Print top 5 for verification
    print("\n=== TOP 5 GOLDEN RESPONSES ===")
    for r in golden_responses[:5]:
        print(f"\n[{r['id']}] Score: {r['quality_score']}, Reuse: {r['reuse_count']}, Thread: {r['avg_thread_length']}")
        print(f"Tags: {r['associated_tags']}")
        print(f"Text: {r['text'][:200]}...")

def extract_topic(template: str) -> str:
    """Extract likely topic from template text."""
    keywords = {
        "transfer": ["transfer", "move", "change email"],
        "refund": ["refund", "money back", "cancel"],
        "access": ["access", "login", "password", "can't log"],
        "discount": ["discount", "coupon", "code", "ppp"],
        "team": ["team", "license", "seats"],
        "invoice": ["invoice", "receipt", "tax"],
        "download": ["download", "zip", "video"],
        "content": ["module", "lesson", "workshop", "course"],
    }
    template_lower = template.lower()
    for topic, terms in keywords.items():
        if any(term in template_lower for term in terms):
            return topic
    return "general"

def get_top_tags(responses: list) -> list:
    """Get most common tags across responses."""
    tag_counts = defaultdict(int)
    for r in responses:
        for tag in r.get("associated_tags", []):
            if tag:
                tag_counts[tag] += r["reuse_count"]
    return sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:15]

if __name__ == "__main__":
    main()
