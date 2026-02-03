#!/usr/bin/env bun
/**
 * Import skills to Upstash Vector with MINIMAL metadata.
 * Vector DB is for semantic search only — full content lives in Redis.
 *
 * Usage:
 *   bun scripts/import-upstash-vector.ts --input artifacts/skills-export.jsonl
 *
 * Secrets (via secrets CLI or env):
 *   UPSTASH_VECTOR_REST_URL
 *   UPSTASH_VECTOR_REST_TOKEN
 */

import { parseArgs } from "util";
import { readFileSync } from "fs";
import { Index } from "@upstash/vector";

const BATCH_SIZE = 50;
const DELAY_MS = 100;

interface ExportRecord {
  id: string;
  data: string;
  metadata: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonl(filePath: string): ExportRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      namespace: { type: "string", short: "n", default: "skills" },
      "dry-run": { type: "boolean" },
    },
  });

  if (!values.input) {
    console.log("Usage: bun scripts/import-upstash-vector.ts --input artifacts/skills-export.jsonl");
    process.exit(1);
  }

  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!url || !token) {
    console.error("Missing UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN");
    process.exit(1);
  }

  const index = new Index({ url, token });
  const namespace = values.namespace || "skills";
  const ns = index.namespace(namespace);

  console.log("Checking Upstash Vector connection...");
  const info = await index.info();
  console.log(`  Connected! Dimension: ${info.dimension}, Model: ${info.denseIndex?.embeddingModel}`);

  const records = readJsonl(values.input);
  console.log(`\nImporting ${records.length} skills to namespace "${namespace}"`);
  console.log("  Strategy: MINIMAL metadata in Vector, full content in Redis\n");

  if (values["dry-run"]) {
    console.log("[DRY RUN] Would import:");
    records.slice(0, 3).forEach((r) => {
      console.log(`  - ${r.metadata.name}: "${r.data.slice(0, 60)}..."`);
    });
    console.log(`  ... and ${records.length - 3} more`);
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    // MINIMAL metadata — just enough to identify the skill
    const upsertData = batch.map((record) => ({
      id: record.metadata.name as string, // Use skill name as ID
      data: record.data, // Description text — Upstash will embed this
      metadata: {
        skill_id: record.metadata.name, // For filtering/verification
      },
    }));

    try {
      await ns.upsert(upsertData);
      success += batch.length;
    } catch (err) {
      console.error(`\nBatch failed:`, err);
      failed += batch.length;
    }

    process.stdout.write(`\r  Imported ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}...`);

    if (i + BATCH_SIZE < records.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n\n✅ Vector import complete!`);
  console.log(`  Success: ${success}, Failed: ${failed}`);

  const finalInfo = await index.info();
  const nsInfo = finalInfo.namespaces?.[namespace];
  console.log(`  Namespace "${namespace}": ${nsInfo?.vectorCount || "?"} vectors`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
