#!/usr/bin/env bun
/**
 * Template Review Queue Worker
 * Processes template regeneration jobs from the queue
 */

import { SwarmWorker } from "/home/joel/Code/joelhooks/swarm-tools/packages/swarm-queue/src/worker";
import Database from "duckdb";
import crypto from "crypto";
import { generateText } from "ai";
import type { JobResult } from "/home/joel/Code/joelhooks/swarm-tools/packages/swarm-queue/src/types";

const DB_PATH = "../ralph-gold-data/gold.duckdb";
const QUEUE_NAME = "template-review";

interface TemplateJobData {
  templateId: string;
  currentTemplate: string;
  steering: string;
  pattern: string;
  category: string;
  conversationId: string;
  variables: string;
  confidence: number;
  source: string;
  traceId: string;
}

interface TemplateJobResult {
  templateId: string;
  newTemplateId: string;
  newVersion: number;
  success: boolean;
}

// LLM regeneration using AI SDK + Vercel AI Gateway
async function regenerateTemplate(current: string, steering: string): Promise<string> {
  const result = await generateText({
    model: "anthropic/claude-haiku-4-5", // Gateway format, current model
    system: `You are improving a customer support response template. Keep the same {{variables}} placeholders. Return ONLY the improved template text, nothing else.`,
    messages: [
      {
        role: "user",
        content: `Current template:
${current}

Feedback to incorporate:
${steering}

Rewrite the template incorporating this feedback.`,
      },
    ],
  });

  return result.text.trim();
}

// Webhook config
const MOLTBOT_HOOK_URL = "http://127.0.0.1:18789/hooks/workflow";
const MOLTBOT_HOOK_TOKEN = process.env.MOLTBOT_HOOK_TOKEN || "59bc856565434a5aa6c140782143d1ac48d7b9714ca052ed";

// Notify via Moltbot webhook (agent sees these)
async function notifyWorkflow(event: {
  type: string;
  jobId?: string;
  templateId?: string;
  status: "success" | "failed" | "progress";
  version?: number;
  pattern?: string;
  error?: string;
  progress?: { stage: string; percent: number };
}) {
  try {
    await fetch(MOLTBOT_HOOK_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MOLTBOT_HOOK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch (e) {
    console.error("Webhook notification failed:", e);
  }
}

// Legacy notify removed — now using webhook via notifyWorkflow()

const worker = new SwarmWorker<TemplateJobData, TemplateJobResult>(
  {
    queueName: QUEUE_NAME,
    connection: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    },
    concurrency: 2, // Process 2 at a time
  },
  async (job): Promise<JobResult<TemplateJobResult>> => {
    const {
      templateId,
      currentTemplate,
      steering,
      pattern,
      category,
      conversationId,
      variables,
      confidence,
      source,
      traceId,
    } = job.data.payload;

    console.log(`[template-review] Processing: ${templateId.slice(0, 8)}... | ${traceId}`);
    console.log(`[template-review] Steering: ${steering}`);

    try {
      await job.updateProgress({ stage: "regenerating", percent: 20 });

      // Call LLM to regenerate
      const improved = await regenerateTemplate(currentTemplate, steering);

      await job.updateProgress({ stage: "saving", percent: 80 });

      // Get current version and save new version
      const db = new Database.Database(DB_PATH);
      const conn = db.connect();

      // Get current version
      const current = await new Promise<any>((res, rej) => {
        conn.all(`SELECT version FROM templates WHERE id = ?`, templateId, (err, rows) =>
          err ? rej(err) : res(rows?.[0])
        );
      });

      const newId = crypto.randomUUID();
      const newVersion = (current?.version || 1) + 1;

      // Insert new version
      await new Promise((res, rej) => {
        conn.run(
          `INSERT INTO templates (id, conversation_id, pattern, template, variables, category, confidence, source, status, steering, parent_id, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          newId,
          conversationId,
          pattern,
          improved,
          variables,
          category,
          confidence,
          source,
          steering,
          templateId,
          newVersion,
          (err) => (err ? rej(err) : res(null))
        );
      });

      // Mark old as superseded
      await new Promise((res, rej) => {
        conn.run(`UPDATE templates SET status = 'superseded' WHERE id = ?`, templateId, (err) =>
          err ? rej(err) : res(null)
        );
      });

      conn.close();
      db.close();

      await job.updateProgress({ stage: "completed", percent: 100 });

      console.log(`[template-review] Created v${newVersion}: ${newId.slice(0, 8)}...`);

      // Notify via webhook (agent sees this)
      await notifyWorkflow({
        type: "template.regenerated",
        jobId: job.id,
        templateId: newId,
        status: "success",
        version: newVersion,
        pattern,
      });

      return {
        success: true,
        data: {
          templateId,
          newTemplateId: newId,
          newVersion,
          success: true,
        },
        metadata: { traceId },
      };
    } catch (error) {
      console.error(`[template-review] Failed: ${templateId}`, error);
      
      // Notify via webhook (agent sees this)
      await notifyWorkflow({
        type: "template.regenerated",
        jobId: job.id,
        templateId,
        status: "failed",
        pattern,
        error: String(error),
      });

      return {
        success: false,
        error: String(error),
        data: {
          templateId,
          newTemplateId: "",
          newVersion: 0,
          success: false,
        },
      };
    }
  }
);

console.log("Template Review worker started. Press Ctrl+C to stop.");
console.log(`Queue: ${QUEUE_NAME}`);
console.log(`Concurrency: 2`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await worker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
