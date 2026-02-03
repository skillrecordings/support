#!/usr/bin/env bun
/**
 * Export TEXT + metadata from local Qdrant collections.
 * Exports skills and conversations without vectors (Upstash will auto-embed).
 *
 * Usage:
 *   bun scripts/export-qdrant-text.ts --collection skills --output artifacts/skills-export.jsonl
 *   bun scripts/export-qdrant-text.ts --collection conversations --output artifacts/conversations-export.jsonl
 *   bun scripts/export-qdrant-text.ts --all --output-dir artifacts/
 */

import { parseArgs } from "util";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const BATCH_SIZE = 100;

interface QdrantPoint {
  id: string | number;
  payload: Record<string, unknown>;
}

interface ExportRecord {
  id: string;
  data: string; // TEXT for Upstash to embed
  metadata: Record<string, unknown>;
}

/**
 * Extract the text field to embed based on collection type
 */
function extractText(collection: string, payload: Record<string, unknown>): string {
  switch (collection) {
    case "skills":
      // Skills: embed the description
      return (payload.description as string) || "";
    case "conversations":
      // Conversations: embed the preview
      return (payload.preview as string) || "";
    case "knowledge":
      // Knowledge: embed the content or summary
      return (payload.content as string) || (payload.summary as string) || "";
    default:
      // Fallback: try common fields
      return (
        (payload.text as string) ||
        (payload.content as string) ||
        (payload.description as string) ||
        (payload.preview as string) ||
        ""
      );
  }
}

/**
 * Transform Qdrant point to Upstash-ready format
 */
function transformPoint(collection: string, point: QdrantPoint): ExportRecord | null {
  const text = extractText(collection, point.payload);

  if (!text || text.trim().length === 0) {
    console.warn(`Skipping point ${point.id}: no text content`);
    return null;
  }

  // Build metadata (exclude the text field we're embedding)
  const metadata: Record<string, unknown> = {
    source_collection: collection,
    original_id: point.id,
  };

  // Copy payload fields to metadata
  for (const [key, value] of Object.entries(point.payload)) {
    // Skip the field we're using as text
    if (collection === "skills" && key === "description") continue;
    if (collection === "conversations" && key === "preview") continue;
    if (collection === "knowledge" && (key === "content" || key === "summary")) continue;

    metadata[key] = value;
  }

  return {
    id: `${collection}-${point.id}`,
    data: text,
    metadata,
  };
}

/**
 * Scroll through all points in a collection
 */
async function* scrollCollection(collection: string): AsyncGenerator<QdrantPoint[]> {
  let offset: string | number | null = null;

  while (true) {
    const body: Record<string, unknown> = {
      limit: BATCH_SIZE,
      with_payload: true,
      with_vector: false, // Don't need vectors - Upstash will re-embed
    };

    if (offset !== null) {
      body.offset = offset;
    }

    const response = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Qdrant scroll failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const points = data.result?.points || [];

    if (points.length === 0) {
      break;
    }

    yield points;

    // Get next offset
    offset = data.result?.next_page_offset;
    if (offset === null || offset === undefined) {
      break;
    }
  }
}

/**
 * Export a single collection to JSONL
 */
async function exportCollection(collection: string, outputPath: string): Promise<number> {
  console.log(`\nExporting collection: ${collection}`);

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  const records: string[] = [];
  let totalPoints = 0;
  let skippedPoints = 0;

  for await (const batch of scrollCollection(collection)) {
    for (const point of batch) {
      totalPoints++;
      const record = transformPoint(collection, point);

      if (record) {
        records.push(JSON.stringify(record));
      } else {
        skippedPoints++;
      }
    }

    process.stdout.write(`\r  Processed ${totalPoints} points...`);
  }

  console.log(`\n  Total: ${totalPoints}, Exported: ${records.length}, Skipped: ${skippedPoints}`);

  // Write JSONL
  writeFileSync(outputPath, records.join("\n") + "\n");
  console.log(`  Written to: ${outputPath}`);

  return records.length;
}

/**
 * Get collection info
 */
async function getCollectionInfo(collection: string): Promise<{ points_count: number }> {
  const response = await fetch(`${QDRANT_URL}/collections/${collection}`);
  if (!response.ok) {
    throw new Error(`Failed to get collection info: ${response.status}`);
  }
  const data = await response.json();
  return { points_count: data.result?.points_count || 0 };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      collection: { type: "string", short: "c" },
      output: { type: "string", short: "o" },
      all: { type: "boolean" },
      "output-dir": { type: "string", short: "d" },
    },
  });

  const collections = ["skills", "conversations"];

  if (values.all) {
    const outputDir = values["output-dir"] || "artifacts";
    console.log("Exporting all collections...");

    let totalExported = 0;
    for (const collection of collections) {
      const info = await getCollectionInfo(collection);
      console.log(`\n${collection}: ${info.points_count} points`);

      const outputPath = `${outputDir}/${collection}-export.jsonl`;
      const count = await exportCollection(collection, outputPath);
      totalExported += count;
    }

    console.log(`\n✅ Export complete! Total records: ${totalExported}`);
  } else if (values.collection && values.output) {
    const info = await getCollectionInfo(values.collection);
    console.log(`Collection ${values.collection}: ${info.points_count} points`);

    await exportCollection(values.collection, values.output);
    console.log("\n✅ Export complete!");
  } else {
    console.log(`
Usage:
  bun scripts/export-qdrant-text.ts --collection skills --output artifacts/skills-export.jsonl
  bun scripts/export-qdrant-text.ts --collection conversations --output artifacts/conversations-export.jsonl
  bun scripts/export-qdrant-text.ts --all --output-dir artifacts/
    `);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
