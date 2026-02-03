#!/usr/bin/env bun
/**
 * Populate Upstash Redis with metadata cache for fast lookups.
 *
 * Usage:
 *   bun scripts/populate-upstash-redis.ts --input artifacts/skills-export.jsonl --prefix skill:
 *   bun scripts/populate-upstash-redis.ts --input artifacts/conversations-export.jsonl --prefix conv:
 *   bun scripts/populate-upstash-redis.ts --all --input-dir artifacts/
 *
 * Secrets (via secrets CLI or env):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { parseArgs } from "util";
import { readFileSync, readdirSync } from "fs";
import { Redis } from "@upstash/redis";

const BATCH_SIZE = 100;

interface ExportRecord {
  id: string;
  data: string;
  metadata: Record<string, unknown>;
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
 * Populate Redis with metadata
 */
async function populateRedis(
  redis: Redis,
  records: ExportRecord[],
  prefix: string
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Use pipeline for batch operations
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const pipeline = redis.pipeline();

    for (const record of batch) {
      const key = `${prefix}${record.id}`;
      // Store metadata + text as JSON
      pipeline.set(key, JSON.stringify({
        id: record.id,
        text: record.data,
        ...record.metadata,
      }));
    }

    try {
      await pipeline.exec();
      success += batch.length;
    } catch (err) {
      console.error(`\nBatch ${i / BATCH_SIZE + 1} failed:`, err);
      failed += batch.length;
    }

    const progress = Math.min(i + BATCH_SIZE, records.length);
    process.stdout.write(`\r  Populated ${progress}/${records.length} keys...`);
  }

  console.log(); // New line after progress
  return { success, failed };
}

/**
 * Populate from a single file
 */
async function populateFile(
  redis: Redis,
  filePath: string,
  prefix: string
): Promise<{ success: number; failed: number }> {
  console.log(`\nPopulating from: ${filePath}`);
  console.log(`  Key prefix: ${prefix}`);

  const records = readJsonl(filePath);
  console.log(`  Records: ${records.length}`);

  return populateRedis(redis, records, prefix);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      prefix: { type: "string", short: "p" },
      all: { type: "boolean" },
      "input-dir": { type: "string", short: "d" },
      "dry-run": { type: "boolean" },
    },
  });

  // Check for credentials
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
    console.error("\nSet via environment or use secrets CLI:");
    console.error(
      '  export UPSTASH_REDIS_REST_URL=$(secrets lease upstash_redis_url --raw --ttl 1h --client-id "migration")'
    );
    console.error(
      '  export UPSTASH_REDIS_REST_TOKEN=$(secrets lease upstash_redis_token --raw --ttl 1h --client-id "migration")'
    );
    process.exit(1);
  }

  const redis = new Redis({ url, token });

  // Check connection
  console.log("Checking Upstash Redis connection...");
  const pong = await redis.ping();
  console.log(`  Connected! Ping: ${pong}`);

  const dbSize = await redis.dbsize();
  console.log(`  Current keys: ${dbSize}`);

  if (values["dry-run"]) {
    console.log("\n[DRY RUN] Would populate but not executing.");
  }

  let totalSuccess = 0;
  let totalFailed = 0;

  if (values.all) {
    const inputDir = values["input-dir"] || "artifacts";
    const files = readdirSync(inputDir).filter((f) => f.endsWith("-export.jsonl"));

    console.log(`\nPopulating from all files in ${inputDir}/`);
    console.log(`  Found: ${files.join(", ")}`);

    // Prefix mapping
    const prefixMap: Record<string, string> = {
      "skills-export.jsonl": "skill:",
      "conversations-export.jsonl": "conv:",
    };

    for (const file of files) {
      const prefix = prefixMap[file] || `${file.replace("-export.jsonl", "")}:`;
      const filePath = `${inputDir}/${file}`;

      if (!values["dry-run"]) {
        const result = await populateFile(redis, filePath, prefix);
        totalSuccess += result.success;
        totalFailed += result.failed;
      } else {
        const records = readJsonl(filePath);
        console.log(`\n  Would populate ${records.length} keys with prefix "${prefix}"`);
      }
    }
  } else if (values.input) {
    const prefix = values.prefix || "rec:";

    if (!values["dry-run"]) {
      const result = await populateFile(redis, values.input, prefix);
      totalSuccess = result.success;
      totalFailed = result.failed;
    } else {
      const records = readJsonl(values.input);
      console.log(`\nWould populate ${records.length} keys with prefix "${prefix}"`);
    }
  } else {
    console.log(`
Usage:
  bun scripts/populate-upstash-redis.ts --input artifacts/skills-export.jsonl --prefix skill:
  bun scripts/populate-upstash-redis.ts --input artifacts/conversations-export.jsonl --prefix conv:
  bun scripts/populate-upstash-redis.ts --all --input-dir artifacts/
  bun scripts/populate-upstash-redis.ts --all --dry-run
    `);
    process.exit(1);
  }

  if (!values["dry-run"]) {
    // Final stats
    const finalSize = await redis.dbsize();
    console.log(`\n✅ Redis population complete!`);
    console.log(`  Success: ${totalSuccess}, Failed: ${totalFailed}`);
    console.log(`  Total keys now: ${finalSize}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
