/**
 * Evalite-based evaluation for real agent responses from production
 *
 * Tests the existing scorers against 37 real agent responses exported from Front.
 * This eval validates that our quality scorers correctly detect known bad patterns
 * in actual production responses.
 *
 * Dataset: packages/cli/data/eval-dataset.json (37 samples)
 *
 * Run: bunx evalite watch
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { evalite } from 'evalite'
import {
  BannedPhrases,
  Helpfulness,
  InternalStateLeakage,
  MetaCommentary,
  ProductFabrication,
} from './response-quality.eval'

// ============================================================================
// Load Dataset
// ============================================================================

interface DatasetSample {
  id: string
  app: string
  conversationId: string
  customerEmail: string
  triggerMessage: {
    subject: string
    body: string
    timestamp: number
  }
  agentResponse: {
    text: string
    category: string
    timestamp: string
  }
}

const datasetPath = join(__dirname, '../../../cli/data/eval-dataset.json')
const dataset: DatasetSample[] = JSON.parse(readFileSync(datasetPath, 'utf-8'))

console.log(`Loaded ${dataset.length} samples from eval dataset`)

// ============================================================================
// Test Data Mapping
// ============================================================================

const testData = dataset.map((sample) => ({
  input: sample.triggerMessage.subject,
  output: sample.agentResponse.text,
  metadata: {
    id: sample.id,
    conversationId: sample.conversationId,
    category: sample.agentResponse.category,
  },
}))

// ============================================================================
// Evalite Evaluation
// ============================================================================

evalite('Real Agent Responses - Quality Scorers', {
  data: testData.map((d) => ({
    input: d.input,
    expected: '', // No expected outputs - just checking for bad patterns
    metadata: d.metadata,
  })),

  task: async (input) => {
    // Return the pre-recorded agent response
    const match = testData.find((d) => d.input === input)
    return match?.output || ''
  },

  scorers: [
    InternalStateLeakage,
    MetaCommentary,
    BannedPhrases,
    ProductFabrication,
    Helpfulness,
  ],
})

// ============================================================================
// Summary Stats
// ============================================================================

/**
 * Expected failure patterns in this dataset:
 *
 * Based on hivemind memory:
 * - internal_state_leak: 8 samples (e.g., "No instructor routing configured")
 * - meta_commentary: 8 samples (e.g., "I won't respond to this. Per my guidelines...")
 * - banned_phrases: 3 samples (corporate speak, fake enthusiasm)
 * - fabrication: 1 sample (invented course content)
 * - deflection: 3 samples (unhelpful deflections)
 * - good_response: 8 samples (should pass all scorers)
 * - mixed: 2 samples (has issues but attempts to help)
 *
 * The scorers should detect these patterns and score accordingly:
 * - 0 = pattern detected (failure)
 * - 1 = no pattern detected (pass)
 * - 0-1 = partial score (Helpfulness scorer)
 */
