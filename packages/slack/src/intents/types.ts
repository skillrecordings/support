export type IntentCategory =
  | 'status_query'
  | 'draft_action'
  | 'context_lookup'
  | 'escalation'
  | 'quick_action'
  | 'unknown'

export interface ParsedIntent {
  category: IntentCategory
  confidence: number
  entities: Record<string, string>
  rawText: string
}
