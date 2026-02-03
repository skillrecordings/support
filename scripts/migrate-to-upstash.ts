#!/usr/bin/env bun
/**
 * Full migration pipeline: Qdrant → Upstash Vector + Redis
 *
 * Usage:
 *   bun scripts/migrate-to-upstash.ts
 *   bun scripts/migrate-to-upstash.ts --dry-run
 *   bun scripts/migrate-to-upstash.ts --skills-only
 *   bun scripts/migrate-to-upstash.ts --conversations-only
 *
 * Prerequisites:
 *   - Local Qdrant running at localhost:6333
 *   - Upstash credentials in environment (or use secrets CLI)
 *
 * Secrets setup:
 *   export UPSTASH_VECTOR_REST_URL=$(secrets lease upstash_vector_url --raw --ttl 1h --client-id "migration")
 *   export UPSTASH_VECTOR_REST_TOKEN=$(secrets lease upstash_vector_token --raw --ttl 1h --client-id "migration")
 *   export UPSTASH_REDIS_REST_URL=$(secrets lease upstash_redis_url --raw --ttl 1h --client-id "migration")
 *   export UPSTASH_REDIS_REST_TOKEN=$(secrets lease upstash_redis_token --raw --ttl 1h --client-id "migration")
 */

import { parseArgs } from "util";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";

const ARTIFACTS_DIR = "artifacts";

function runScript(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n$ bun ${scriptPath} ${args.join(" ")}`);
    console.log("-".repeat(60));

    const proc = spawn("bun", [scriptPath, ...args], {
      stdio: "inherit",
      env: process.env,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script failed with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

async function checkQdrant(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:6333/collections");
    return response.ok;
  } catch {
    return false;
  }
}

async function checkUpstash(): Promise<{ vector: boolean; redis: boolean }> {
  const result = { vector: false, redis: false };

  // Check Vector
  const vectorUrl = process.env.UPSTASH_VECTOR_REST_URL;
  const vectorToken = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (vectorUrl && vectorToken) {
    try {
      const response = await fetch(`${vectorUrl}/info`, {
        headers: { Authorization: `Bearer ${vectorToken}` },
      });
      result.vector = response.ok;
    } catch {
      result.vector = false;
    }
  }

  // Check Redis
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    try {
      const response = await fetch(`${redisUrl}/ping`, {
        headers: { Authorization: `Bearer ${redisToken}` },
      });
      result.redis = response.ok;
    } catch {
      result.redis = false;
    }
  }

  return result;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": { type: "boolean" },
      "skills-only": { type: "boolean" },
      "conversations-only": { type: "boolean" },
      "skip-export": { type: "boolean" },
      "skip-vector": { type: "boolean" },
      "skip-redis": { type: "boolean" },
    },
  });

  console.log("🚀 Qdrant → Upstash Migration");
  console.log("=".repeat(60));

  // Pre-flight checks
  console.log("\n📋 Pre-flight checks:");

  const qdrantOk = await checkQdrant();
  console.log(`  Qdrant (localhost:6333): ${qdrantOk ? "✅" : "❌"}`);
  if (!qdrantOk && !values["skip-export"]) {
    console.error("\nError: Qdrant not reachable. Start it or use --skip-export");
    process.exit(1);
  }

  const upstashOk = await checkUpstash();
  console.log(`  Upstash Vector: ${upstashOk.vector ? "✅" : "❌"}`);
  console.log(`  Upstash Redis: ${upstashOk.redis ? "✅" : "❌"}`);

  if (!upstashOk.vector && !values["skip-vector"]) {
    console.error("\nError: Upstash Vector credentials missing. Set UPSTASH_VECTOR_REST_URL and _TOKEN");
    process.exit(1);
  }

  if (!upstashOk.redis && !values["skip-redis"]) {
    console.error("\nError: Upstash Redis credentials missing. Set UPSTASH_REDIS_REST_URL and _TOKEN");
    process.exit(1);
  }

  // Ensure artifacts dir
  if (!existsSync(ARTIFACTS_DIR)) {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  // Determine what to migrate
  const collections: string[] = [];
  if (values["skills-only"]) {
    collections.push("skills");
  } else if (values["conversations-only"]) {
    collections.push("conversations");
  } else {
    collections.push("skills", "conversations");
  }

  console.log(`\n📦 Collections to migrate: ${collections.join(", ")}`);

  if (values["dry-run"]) {
    console.log("\n[DRY RUN MODE]");
  }

  // Step 1: Export from Qdrant
  if (!values["skip-export"]) {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 1: Export from Qdrant");
    console.log("=".repeat(60));

    for (const collection of collections) {
      const outputPath = `${ARTIFACTS_DIR}/${collection}-export.jsonl`;
      await runScript("scripts/export-qdrant-text.ts", [
        "--collection", collection,
        "--output", outputPath,
      ]);
    }
  } else {
    console.log("\n⏭️  Skipping export (--skip-export)");
  }

  // Step 2: Import to Upstash Vector
  if (!values["skip-vector"]) {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 2: Import to Upstash Vector");
    console.log("=".repeat(60));

    for (const collection of collections) {
      const inputPath = `${ARTIFACTS_DIR}/${collection}-export.jsonl`;
      const args = ["--input", inputPath, "--namespace", collection];
      if (values["dry-run"]) args.push("--dry-run");

      await runScript("scripts/import-upstash-vector.ts", args);
    }
  } else {
    console.log("\n⏭️  Skipping Vector import (--skip-vector)");
  }

  // Step 3: Populate Upstash Redis
  if (!values["skip-redis"]) {
    console.log("\n" + "=".repeat(60));
    console.log("STEP 3: Populate Upstash Redis");
    console.log("=".repeat(60));

    const prefixMap: Record<string, string> = {
      skills: "skill:",
      conversations: "conv:",
    };

    for (const collection of collections) {
      const inputPath = `${ARTIFACTS_DIR}/${collection}-export.jsonl`;
      const prefix = prefixMap[collection] || `${collection}:`;
      const args = ["--input", inputPath, "--prefix", prefix];
      if (values["dry-run"]) args.push("--dry-run");

      await runScript("scripts/populate-upstash-redis.ts", args);
    }
  } else {
    console.log("\n⏭️  Skipping Redis population (--skip-redis)");
  }

  // Done
  console.log("\n" + "=".repeat(60));
  console.log("✅ MIGRATION COMPLETE!");
  console.log("=".repeat(60));

  if (values["dry-run"]) {
    console.log("\nThis was a dry run. Run without --dry-run to execute.");
  } else {
    console.log(`
Next steps:
  1. Verify data in Upstash Console
  2. Update Epic 3 validator to use Upstash
  3. Test skill retrieval in staging
    `);
  }
}

main().catch((err) => {
  console.error("\n❌ Migration failed:", err.message);
  process.exit(1);
});
