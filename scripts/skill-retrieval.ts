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
import { retrieveSkills } from "../packages/core/src/skill-retrieval";

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
