/**
 * Simple LLM classification - calls Claude directly, no mocks, no complex deps
 */
import Anthropic from "@anthropic-ai/sdk";
import Database from "duckdb";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const CATEGORIES = [
  "support_access",
  "support_refund",
  "support_transfer",
  "support_technical",
  "support_billing",
  "presales_faq",
  "presales_consult",
  "presales_team",
  "fan_mail",
  "spam",
  "system",
  "voc_response",
];

async function classifyEmail(subject: string, body: string): Promise<string> {
  const response = await client.messages.create({
    model: "claude-3-haiku-[PHONE]",
    max_tokens: 50,
    messages: [
      {
        role: "user",
        content: `Classify this support email into exactly one category.

Categories: ${CATEGORIES.join(", ")}

Subject: ${subject}
Body: ${body.slice(0, 1000)}

Reply with ONLY the category name, nothing else.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim().toLowerCase() : "";
  
  // Validate it's a known category
  const matched = CATEGORIES.find((c) => text.includes(c));
  return matched || "unknown";
}

async function main() {
  const db = new Database.Database("gold.duckdb");
  const conn = db.connect();

  // Get gold conversations
  const rows = conn.all(`
    SELECT id, subject, 
           json_extract_string(trigger_message, '$.body') as body,
           request_type as old_type
    FROM conversations 
    WHERE is_gold = true
  `) as Array<{ id: string; subject: string; body: string; old_type: string }>;

  console.log(`Found ${rows.length} gold conversations to classify`);

  const results: Array<{ id: string; old: string; new: string }> = [];

  for (const row of rows) {
    console.log(`Classifying ${row.id}...`);
    const newType = await classifyEmail(row.subject || "", row.body || "");
    
    // Update DB
    conn.run(`UPDATE conversations SET request_type = ? WHERE id = ?`, newType, row.id);
    conn.run(`UPDATE classifications SET request_type = ? WHERE conversation_id = ?`, newType, row.id);
    
    results.push({ id: row.id, old: row.old_type, new: newType });
    console.log(`  ${row.old_type} → ${newType}`);
    
    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  const summary = results.reduce((acc, r) => {
    acc[r.new] = (acc[r.new] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("\n=== Classification Summary ===");
  for (const [cat, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`${cat}: ${count}`);
  }

  const changed = results.filter((r) => r.old !== r.new).length;
  console.log(`\nChanged: ${changed}/${results.length}`);

  conn.close();
  db.close();
}

main().catch(console.error);
