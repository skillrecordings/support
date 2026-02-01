/**
 * Fast classification using Vercel AI Gateway
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import Database from "duckdb";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("ERROR: AI_GATEWAY_API_KEY not set");
  process.exit(1);
}

const anthropic = createAnthropic({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: AI_GATEWAY_API_KEY,
});

const CATEGORIES = [
  "support_access", "support_refund", "support_transfer", "support_technical", 
  "support_billing", "presales_faq", "presales_consult", "presales_team",
  "fan_mail", "spam", "system", "voc_response"
];

interface Row {
  id: string;
  subject: string | null;
  body: string | null;
  old_type: string;
}

async function classify(subject: string, body: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: anthropic("claude-3-haiku-[PHONE]"),
      maxTokens: 20,
      prompt: `Classify this support email into ONE category: ${CATEGORIES.join(", ")}

Subject: ${subject || "No subject"}
Body: ${(body || "").slice(0, 800)}

Reply with ONLY the category name.`,
    });
    
    const lower = text.toLowerCase().trim();
    return CATEGORIES.find(c => lower.includes(c)) || "unknown";
  } catch (e) {
    console.error("  Error:", e);
    return "unknown";
  }
}

async function main() {
  const db = new Database.Database("gold.duckdb");
  
  // Promisify the query
  const rows: Row[] = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, subject, 
              json_extract_string(trigger_message, '$.body') as body,
              request_type as old_type
       FROM conversations 
       WHERE is_gold = true AND request_type IN ('unknown', 'voc_response')`,
      (err: Error | null, result: Row[]) => {
        if (err) reject(err);
        else resolve(result || []);
      }
    );
  });

  console.log(`=== Classifying ${rows.length} conversations ===`);

  // Process in parallel batches of 5
  const BATCH = 5;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (row) => {
        const newType = await classify(row.subject || "", row.body || "");
        console.log(`[${i + batch.indexOf(row) + 1}/${rows.length}] ${row.id}: ${row.old_type} → ${newType}`);
        return { id: row.id, newType };
      })
    );

    // Update DB
    for (const { id, newType } of results) {
      await new Promise<void>((resolve, reject) => {
        db.run(`UPDATE conversations SET request_type = ? WHERE id = ?`, newType, id, (err: Error | null) => {
          if (err) reject(err); else resolve();
        });
      });
    }
  }

  // Final summary
  const summary: Array<{ request_type: string; count: number }> = await new Promise((resolve, reject) => {
    db.all(
      `SELECT request_type, COUNT(*) as count FROM conversations WHERE is_gold = true GROUP BY request_type ORDER BY count DESC`,
      (err: Error | null, result: Array<{ request_type: string; count: number }>) => {
        if (err) reject(err);
        else resolve(result || []);
      }
    );
  });

  console.log("\n=== Final Distribution ===");
  for (const row of summary) {
    console.log(`${row.request_type}: ${row.count}`);
  }

  db.close();
}

main().catch(console.error);
