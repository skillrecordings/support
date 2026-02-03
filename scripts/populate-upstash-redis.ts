#!/usr/bin/env bun
/**
 * Populate Upstash Redis with FULL skill content.
 * Redis is the source of truth for skill data — Vector only has embeddings.
 *
 * Stores:
 *   - skill_id, name, description, path
 *   - Full SKILL.md content (if available)
 *
 * Usage:
 *   bun scripts/populate-upstash-redis.ts --input artifacts/skills-export.jsonl
 *   bun scripts/populate-upstash-redis.ts --input artifacts/skills-export.jsonl --include-markdown
 *
 * Secrets (via secrets CLI or env):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { parseArgs } from "util";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Redis } from "@upstash/redis";

const BATCH_SIZE = 50;

interface ExportRecord {
  id: string;
  data: string;
  metadata: Record<string, unknown>;
}

interface SkillData {
  skill_id: string;
  name: string;
  description: string;
  path: string;
  sample_size?: number;
  markdown?: string; // Full SKILL.md content
  indexed_at: string;
}

function readJsonl(filePath: string): ExportRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function readSkillMarkdown(skillPath: string): string | undefined {
  // skillPath is like "skills/refund-request/SKILL.md"
  const fullPath = join(process.cwd(), skillPath);

  if (existsSync(fullPath)) {
    try {
      return readFileSync(fullPath, "utf-8");
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      "include-markdown": { type: "boolean", short: "m" },
      "dry-run": { type: "boolean" },
    },
  });

  if (!values.input) {
    console.log("Usage: bun scripts/populate-upstash-redis.ts --input artifacts/skills-export.jsonl [--include-markdown]");
    process.exit(1);
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
    process.exit(1);
  }

  const redis = new Redis({ url, token });
  const includeMarkdown = values["include-markdown"] || false;

  console.log("Checking Upstash Redis connection...");
  const pong = await redis.ping();
  console.log(`  Connected! Ping: ${pong}`);

  const records = readJsonl(values.input);
  console.log(`\nPopulating ${records.length} skills to Redis`);
  console.log(`  Include SKILL.md content: ${includeMarkdown ? "YES" : "NO"}\n`);

  if (values["dry-run"]) {
    console.log("[DRY RUN] Would populate:");
    records.slice(0, 3).forEach((r) => {
      const md = includeMarkdown ? readSkillMarkdown(r.metadata.path as string) : undefined;
      console.log(`  - skill:${r.metadata.name} (${md ? `${md.length} chars markdown` : "no markdown"})`);
    });
    console.log(`  ... and ${records.length - 3} more`);
    return;
  }

  let success = 0;
  let failed = 0;
  let markdownCount = 0;

  // Process in batches using pipeline
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const pipeline = redis.pipeline();

    for (const record of batch) {
      const skillData: SkillData = {
        skill_id: record.metadata.name as string,
        name: record.metadata.name as string,
        description: record.data, // The full description text
        path: record.metadata.path as string,
        sample_size: record.metadata.sample_size as number | undefined,
        indexed_at: new Date().toISOString(),
      };

      // Optionally include full SKILL.md content
      if (includeMarkdown) {
        const markdown = readSkillMarkdown(skillData.path);
        if (markdown) {
          skillData.markdown = markdown;
          markdownCount++;
        }
      }

      const key = `skill:${skillData.skill_id}`;
      pipeline.set(key, JSON.stringify(skillData));
    }

    try {
      await pipeline.exec();
      success += batch.length;
    } catch (err) {
      console.error(`\nBatch failed:`, err);
      failed += batch.length;
    }

    process.stdout.write(`\r  Populated ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}...`);
  }

  console.log(`\n\n✅ Redis population complete!`);
  console.log(`  Success: ${success}, Failed: ${failed}`);
  if (includeMarkdown) {
    console.log(`  Skills with markdown: ${markdownCount}`);
  }

  const dbSize = await redis.dbsize();
  console.log(`  Total Redis keys: ${dbSize}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
