#!/usr/bin/env bun
/**
 * Import TEXT + metadata to Upstash Vector (auto-embeds with native model).
 *
 * Usage:
 *   bun scripts/import-upstash-vector.ts --input artifacts/skills-export.jsonl
 *   bun scripts/import-upstash-vector.ts --input artifacts/conversations-export.jsonl --namespace conversations
 *   bun scripts/import-upstash-vector.ts --all --input-dir artifacts/
 *
 * Secrets (via secrets CLI or env):
 *   UPSTASH_VECTOR_REST_URL
 *   UPSTASH_VECTOR_REST_TOKEN
 */

import { parseArgs } from "util";
import { readFileSync, readdirSync } from "fs";
import { Index } from "@upstash/vector";

const BATCH_SIZE = 50; // Upstash recommends smaller batches for auto-embedding
const DELAY_MS = 100; // Rate limiting between batches

interface ExportRecord {
  id: string;
  data: string;
  metadata: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read JSONL file and parse records
 */
function readJsonl(filePath: string): ExportRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

/**
 * Import records to Upstash Vector
 */
async function importRecords(
  index: Index,
  records: ExportRecord[],
  namespace?: string
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const upsertData = batch.map((record) => ({
      id: record.id,
      data: record.data, // TEXT - Upstash will auto-embed
      metadata: record.metadata,
    }));

    try {
      if (namespace) {
        await index.upsert(upsertData, { namespace });
      } else {
        await index.upsert(upsertData);
      }
      success += batch.length;
    } catch (err) {
      console.error(`\nBatch ${i / BATCH_SIZE + 1} failed:`, err);
      failed += batch.length;
    }

    const progress = Math.min(i + BATCH_SIZE, records.length);
    process.stdout.write(`\r  Imported ${progress}/${records.length} records...`);

    // Rate limiting
    if (i + BATCH_SIZE < records.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(); // New line after progress
  return { success, failed };
}

/**
 * Import a single file
 */
async function importFile(
  index: Index,
  filePath: string,
  namespace?: string
): Promise<{ success: number; failed: number }> {
  console.log(`\nImporting: ${filePath}`);
  if (namespace) {
    console.log(`  Namespace: ${namespace}`);
  }

  const records = readJsonl(filePath);
  console.log(`  Records: ${records.length}`);

  return importRecords(index, records, namespace);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      namespace: { type: "string", short: "n" },
      all: { type: "boolean" },
      "input-dir": { type: "string", short: "d" },
      "dry-run": { type: "boolean" },
    },
  });

  // Check for credentials
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!url || !token) {
    console.error("Missing UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN");
    console.error("\nSet via environment or use secrets CLI:");
    console.error(
      '  export UPSTASH_VECTOR_REST_URL=$(secrets lease upstash_vector_url --raw --ttl 1h --client-id "migration")'
    );
    console.error(
      '  export UPSTASH_VECTOR_REST_TOKEN=$(secrets lease upstash_vector_token --raw --ttl 1h --client-id "migration")'
    );
    process.exit(1);
  }

  const index = new Index({ url, token });

  // Check connection
  console.log("Checking Upstash Vector connection...");
  const info = await index.info();
  console.log(`  Connected! Current vectors: ${info.vectorCount}`);
  console.log(`  Dimension: ${info.dimension}, Model: ${info.denseIndex?.embeddingModel || "unknown"}`);

  if (values["dry-run"]) {
    console.log("\n[DRY RUN] Would import but not executing.");
  }

  let totalSuccess = 0;
  let totalFailed = 0;

  if (values.all) {
    const inputDir = values["input-dir"] || "artifacts";
    const files = readdirSync(inputDir).filter((f) => f.endsWith("-export.jsonl"));

    console.log(`\nImporting all files from ${inputDir}/`);
    console.log(`  Found: ${files.join(", ")}`);

    for (const file of files) {
      // Derive namespace from filename (skills-export.jsonl -> skills)
      const namespace = file.replace("-export.jsonl", "");
      const filePath = `${inputDir}/${file}`;

      if (!values["dry-run"]) {
        const result = await importFile(index, filePath, namespace);
        totalSuccess += result.success;
        totalFailed += result.failed;
      } else {
        const records = readJsonl(filePath);
        console.log(`\n  Would import ${records.length} records to namespace "${namespace}"`);
      }
    }
  } else if (values.input) {
    if (!values["dry-run"]) {
      const result = await importFile(index, values.input, values.namespace);
      totalSuccess = result.success;
      totalFailed = result.failed;
    } else {
      const records = readJsonl(values.input);
      console.log(`\nWould import ${records.length} records`);
    }
  } else {
    console.log(`
Usage:
  bun scripts/import-upstash-vector.ts --input artifacts/skills-export.jsonl
  bun scripts/import-upstash-vector.ts --input artifacts/conversations-export.jsonl --namespace conversations
  bun scripts/import-upstash-vector.ts --all --input-dir artifacts/
  bun scripts/import-upstash-vector.ts --all --dry-run
    `);
    process.exit(1);
  }

  if (!values["dry-run"]) {
    // Final stats
    const finalInfo = await index.info();
    console.log(`\n✅ Import complete!`);
    console.log(`  Success: ${totalSuccess}, Failed: ${totalFailed}`);
    console.log(`  Total vectors now: ${finalInfo.vectorCount}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
