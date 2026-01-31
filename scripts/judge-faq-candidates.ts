#!/usr/bin/env bun
/**
 * FAQ Quality Judge - Opus pass on extracted candidates
 * 
 * Evaluates each FAQ for:
 * - Question clarity (is it a real common question?)
 * - Answer accuracy (is the answer correct and helpful?)
 * - Tone (matches product voice?)
 * - Completeness (self-contained?)
 * 
 * Usage: bun scripts/judge-faq-candidates.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { generateObject } from 'ai'
import { z } from 'zod'

const INPUT_PATH = 'artifacts/phase-1/llm-topics/faq-candidates.jsonl'
const OUTPUT_PATH = 'artifacts/phase-1/llm-topics/faq-judged.jsonl'

interface FaqCandidate {
  topicId: string
  question: string
  answer: string
  confidence: number
  sourceConversations: string[]
  extractedAt: string
  threadLength: number
  qualityScore: number
}

interface JudgedFaq extends FaqCandidate {
  judgment: {
    questionClarity: number      // 1-5
    answerAccuracy: number       // 1-5
    tone: number                 // 1-5
    completeness: number         // 1-5
    overallScore: number         // 1-5
    recommendation: 'approve' | 'edit' | 'reject'
    issues: string[]
    suggestedEdits?: string
  }
}

const judgmentSchema = z.object({
  questionClarity: z.number().min(1).max(5).describe('How clear and common is this question? 5=very clear, common question'),
  answerAccuracy: z.number().min(1).max(5).describe('How accurate and helpful is the answer? 5=completely accurate'),
  tone: z.number().min(1).max(5).describe('Does the tone match a friendly, professional product voice? 5=perfect tone'),
  completeness: z.number().min(1).max(5).describe('Is the answer self-contained and complete? 5=fully complete'),
  overallScore: z.number().min(1).max(5).describe('Overall quality score'),
  recommendation: z.enum(['approve', 'edit', 'reject']).describe('Should this FAQ be approved, edited, or rejected?'),
  issues: z.array(z.string()).describe('List of issues found (empty if none)'),
  suggestedEdits: z.string().optional().describe('Suggested edits if recommendation is "edit"'),
})

async function judgeFaq(faq: FaqCandidate): Promise<JudgedFaq['judgment']> {
  const result = await generateObject({
    model: 'anthropic/claude-opus-4',
    schema: judgmentSchema,
    prompt: `You are a quality reviewer for FAQ content on a software education platform (TypeScript, React courses).

Evaluate this FAQ candidate:

**Topic:** ${faq.topicId}

**Question:** ${faq.question}

**Answer:** ${faq.answer}

**Evaluation criteria:**
1. Question Clarity (1-5): Is this a real, common question customers ask? Is it clear?
2. Answer Accuracy (1-5): Is the answer factually correct and helpful?
3. Tone (1-5): Does it match a friendly but professional voice? Not too corporate, not too casual.
4. Completeness (1-5): Is the answer self-contained? Does it actually answer the question?
5. Overall (1-5): Considering all factors.

**Recommendation:**
- "approve" if overall >= 4 and no major issues
- "edit" if overall 3-4 with fixable issues
- "reject" if overall < 3 or unfixable issues

Be critical but fair. This will help real customers.`,
  })

  return result.object
}

async function main() {
  console.log('=== FAQ Quality Judge (Opus) ===')
  
  // Load candidates
  const lines = readFileSync(INPUT_PATH, 'utf-8').trim().split('\n')
  const candidates: FaqCandidate[] = lines.map(l => JSON.parse(l))
  
  console.log(`Loaded ${candidates.length} candidates`)
  
  const judged: JudgedFaq[] = []
  
  for (let i = 0; i < candidates.length; i++) {
    const faq = candidates[i]
    console.log(`\n[${i + 1}/${candidates.length}] Judging: ${faq.topicId}`)
    console.log(`  Q: ${faq.question.slice(0, 60)}...`)
    
    try {
      const judgment = await judgeFaq(faq)
      const result: JudgedFaq = { ...faq, judgment }
      
      console.log(`  Score: ${judgment.overallScore}/5 → ${judgment.recommendation.toUpperCase()}`)
      if (judgment.issues.length > 0) {
        console.log(`  Issues: ${judgment.issues.join(', ')}`)
      }
      
      judged.push(result)
      
      // Write incrementally
      writeFileSync(OUTPUT_PATH, judged.map(j => JSON.stringify(j)).join('\n') + '\n')
      
      // Rate limit
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.error(`  Error: ${err}`)
    }
  }
  
  // Summary
  const approved = judged.filter(j => j.judgment.recommendation === 'approve').length
  const edit = judged.filter(j => j.judgment.recommendation === 'edit').length
  const rejected = judged.filter(j => j.judgment.recommendation === 'reject').length
  const avgScore = judged.reduce((sum, j) => sum + j.judgment.overallScore, 0) / judged.length
  
  console.log(`\n=== Summary ===`)
  console.log(`Approved: ${approved} | Edit: ${edit} | Rejected: ${rejected}`)
  console.log(`Average score: ${avgScore.toFixed(2)}/5`)
  console.log(`Output: ${OUTPUT_PATH}`)
}

main().catch(console.error)
