/**
 * Classifier eval - run classifier on dataset samples and analyze results
 *
 * Usage: npx evalite packages/core/src/evals/classifier.eval.ts
 */

import { readFileSync } from 'fs'
import { evalite } from 'evalite'
import { classifyMessage } from '../router/classifier'

// Load dataset
const datasetPath = process.env.DATASET_PATH || '/tmp/classifier-eval.json'
let dataset: Array<{
  id: string
  triggerMessage: { subject: string; body: string }
  agentResponse: { text: string }
}> = []

try {
  dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'))
} catch {
  console.error(`Failed to load dataset from ${datasetPath}`)
  process.exit(1)
}

// Expected classifications based on content patterns
function getExpectedCategory(message: string, subject: string): string | null {
  const combined = `${subject} ${message}`.toLowerCase()

  // Spam/vendor outreach
  if (
    combined.includes('partnership') ||
    combined.includes('collaborate with') ||
    combined.includes('ugc team') ||
    combined.includes('business outreach')
  ) {
    return 'no_response'
  }

  // Reply to Matt's personal email (AI Hero onboarding)
  if (
    combined.includes('re: a quick question') ||
    combined.includes('what interests you about ai') ||
    combined.includes('re: welcome to ai hero')
  ) {
    return 'instructor_correspondence'
  }

  // Personal message to instructor
  if (
    combined.includes('[aih]') || // Internal tag format
    combined.includes('banger quote') ||
    (combined.includes('hi matt') && !combined.includes('support'))
  ) {
    return 'instructor_correspondence'
  }

  // Actual support requests
  if (
    combined.includes('404') ||
    combined.includes('login') ||
    combined.includes('access') ||
    combined.includes('refund') ||
    combined.includes('purchase')
  ) {
    return 'needs_response'
  }

  return null // Unknown
}

// Scorer: check if classification matches expected
const classificationAccuracy = {
  name: 'Classification Accuracy',
  scorer: async ({
    input,
    output,
  }: {
    input: { message: string; subject: string }
    output: { category: string; complexity: string; confidence: number }
  }) => {
    const expected = getExpectedCategory(input.message, input.subject)
    if (!expected) {
      return { score: 0.5, metadata: { reason: 'no_expected_label' } }
    }
    const correct = output.category === expected
    return {
      score: correct ? 1 : 0,
      metadata: { expected, actual: output.category },
    }
  },
}

// Scorer: check if instructor correspondence is caught
const instructorCorrespondenceCatch = {
  name: 'Instructor Correspondence Detection',
  scorer: async ({
    input,
    output,
  }: {
    input: { message: string; subject: string }
    output: { category: string }
  }) => {
    const expected = getExpectedCategory(input.message, input.subject)
    if (expected !== 'instructor_correspondence') {
      return { score: 1, metadata: { reason: 'not_instructor_correspondence' } }
    }
    const caught = output.category === 'instructor_correspondence'
    return {
      score: caught ? 1 : 0,
      metadata: {
        expected: 'instructor_correspondence',
        actual: output.category,
      },
    }
  },
}

// Scorer: complexity appropriate
const complexityAppropriate = {
  name: 'Complexity Appropriate',
  scorer: async ({
    input,
    output,
  }: {
    input: { message: string; subject: string }
    output: { category: string; complexity: string }
  }) => {
    // instructor_correspondence should be 'simple' (route quickly)
    // no_response should be 'skip'
    // support requests should be 'simple' or 'complex' based on content

    if (
      output.category === 'instructor_correspondence' &&
      output.complexity === 'simple'
    ) {
      return { score: 1 }
    }
    if (output.category === 'no_response' && output.complexity === 'skip') {
      return { score: 1 }
    }
    if (
      output.category === 'needs_response' &&
      ['simple', 'complex'].includes(output.complexity)
    ) {
      return { score: 1 }
    }

    return {
      score: 0.5,
      metadata: { category: output.category, complexity: output.complexity },
    }
  },
}

evalite('Classifier Eval', {
  data: async () => {
    return dataset.slice(0, 20).map((item) => ({
      input: {
        message: item.triggerMessage.body,
        subject: item.triggerMessage.subject,
      },
    }))
  },
  task: async (input) => {
    const result = await classifyMessage(input.message, {})
    return {
      category: result.category,
      complexity: result.complexity,
      confidence: result.confidence,
      reasoning: result.reasoning,
    }
  },
  scorers: [
    classificationAccuracy,
    instructorCorrespondenceCatch,
    complexityAppropriate,
  ],
})
