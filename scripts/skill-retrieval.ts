#!/usr/bin/env bun
/**
 * Skill retrieval helper: Vector search → Redis fetch
 *
 * This is the pattern Epic 3 will use:
 *   1. Semantic search in Upstash Vector to find relevant skill IDs
 *   2. Fetch full skill content from Upstash Redis
 *
 * Usage (CLI test):
 *   bun scripts/skill-retrieval.ts "customer wants a refund"
 *   bun scripts/skill-retrieval.ts "can't access my course" --top-k 5
 *
 * Programmatic usage:
 *   import { retrieveSkills } from "./skill-retrieval";
 *   const skills = await retrieveSkills("refund request", { topK: 3 });
 */

import { parseArgs } from "util";
import { Index } from "@upstash/vector";
import { Redis } from "@upstash/redis";

export interface SkillData {
  skill_id: string;
  name: string;
  description: string;
  path: string;
  sample_size?: number;
  markdown?: string;
  indexed_at: string;
}

export interface RetrievedSkill extends SkillData {
  score: number; // Semantic similarity score
}

export interface RetrievalOptions {
  topK?: number;
  minScore?: number;
  includeMarkdown?: boolean;
}

/**
 * Retrieve skills relevant to a query.
 * Uses Vector for semantic search, Redis for full content.
 */
export async function retrieveSkills(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedSkill[]> {
  const { topK = 3, minScore = 0.01, includeMarkdown = true } = options;

  // Get clients from environment
  const vectorUrl = process.env.UPSTASH_VECTOR_REST_URL;
  const vectorToken = process.env.UPSTASH_VECTOR_REST_TOKEN;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!vectorUrl || !vectorToken || !redisUrl || !redisToken) {
    throw new Error("Missing Upstash credentials in environment");
  }

  const vector = new Index({ url: vectorUrl, token: vectorToken });
  const redis = new Redis({ url: redisUrl, token: redisToken });

  // Step 1: Semantic search in Vector
  const skillsNs = vector.namespace("skills");
  const vectorResults = await skillsNs.query({
    data: query,
    topK,
    includeMetadata: true,
  });

  // Filter by minimum score
  const relevantResults = vectorResults.filter((r) => r.score >= minScore);

  if (relevantResults.length === 0) {
    return [];
  }

  // Step 2: Fetch full content from Redis
  const skillIds = relevantResults.map((r) => r.id);
  const redisKeys = skillIds.map((id) => `skill:${id}`);

  // Batch fetch from Redis
  const pipeline = redis.pipeline();
  for (const key of redisKeys) {
    pipeline.get(key);
  }
  const redisResults = await pipeline.exec();

  // Step 3: Combine Vector scores with Redis content
  const skills: RetrievedSkill[] = [];

  for (let i = 0; i < relevantResults.length; i++) {
    const vectorResult = relevantResults[i];
    const redisData = redisResults[i] as SkillData | null;

    if (redisData) {
      // Redis client auto-parses JSON, so redisData is already an object
      const skillData: SkillData = redisData;

      // Optionally strip markdown to reduce token usage
      if (!includeMarkdown && skillData.markdown) {
        delete skillData.markdown;
      }

      skills.push({
        ...skillData,
        score: vectorResult.score,
      });
    }
  }

  return skills;
}

/**
 * Format skills for inclusion in LLM context
 */
export function formatSkillsForContext(skills: RetrievedSkill[]): string {
  if (skills.length === 0) {
    return "No relevant skills found.";
  }

  return skills
    .map((skill, i) => {
      const header = `## Skill ${i + 1}: ${skill.name} (relevance: ${(skill.score * 100).toFixed(1)}%)`;
      const description = skill.description;
      const markdown = skill.markdown ? `\n\n### Full Documentation:\n${skill.markdown}` : "";

      return `${header}\n${description}${markdown}`;
    })
    .join("\n\n---\n\n");
}

// CLI mode
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "top-k": { type: "string", short: "k", default: "3" },
      "min-score": { type: "string", default: "0.01" },
      "include-markdown": { type: "boolean", short: "m" },
      json: { type: "boolean", short: "j" },
    },
    allowPositionals: true,
  });

  const query = positionals.join(" ");

  if (!query) {
    console.log('Usage: bun scripts/skill-retrieval.ts "your query here" [--top-k 3] [--json]');
    process.exit(1);
  }

  if (!values.json) {
    console.log(`🔍 Query: "${query}"\n`);
  }

  const skills = await retrieveSkills(query, {
    topK: parseInt(values["top-k"] || "3"),
    minScore: parseFloat(values["min-score"] || "0.01"),
    includeMarkdown: values["include-markdown"] || false,
  });

  if (values.json) {
    console.log(JSON.stringify(skills, null, 2));
  } else {
    if (skills.length === 0) {
      console.log("No relevant skills found.");
    } else {
      console.log(`Found ${skills.length} relevant skills:\n`);
      skills.forEach((skill, i) => {
        console.log(`${i + 1}. ${skill.name} (score: ${skill.score.toFixed(4)})`);
        console.log(`   ${skill.description.slice(0, 100)}...`);
        console.log();
      });
    }
  }
}

// Only run CLI if this is the main module
if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
