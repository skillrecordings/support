/**
 * Pipeline type definitions
 *
 * Shared interfaces for all pipeline steps.
 * See ARCHITECTURE.md for design details.
 */

// ============================================================================
// Categories
// ============================================================================

export type MessageCategory =
  | 'support_access' // Login, purchase access issues
  | 'support_refund' // Refund requests
  | 'support_transfer' // License transfers
  | 'support_technical' // Product/code questions
  | 'support_billing' // Invoice, receipt, payment
  | 'fan_mail' // Personal message to instructor
  | 'spam' // Vendor outreach, marketing
  | 'system' // Automated notifications, bounces
  | 'unknown' // Can't classify confidently
  // Thread-aware categories (v3)
  | 'instructor_strategy' // Instructor discussing business/content
  | 'resolved' // Thread already resolved
  | 'awaiting_customer' // Waiting for customer reply
  | 'voc_response' // Voice of customer: replies to our outreach/surveys
  // Presales categories (v4)
  | 'presales_faq' // Answerable with KB (pricing, curriculum, requirements)
  | 'presales_consult' // Needs instructor judgment (which course, career advice)
  | 'presales_team' // Enterprise/team sales inquiries

export type RouteAction =
  | 'respond' // Agent should draft a response
  | 'silence' // No response needed
  | 'escalate_human' // Flag for human review
  | 'escalate_instructor' // Route to instructor
  | 'escalate_urgent' // High priority human review
  | 'support_teammate' // Add context comment, teammate is handling
  | 'catalog_voc' // Catalog VOC response, notify Slack, maybe request expansion

// ============================================================================
// VOC (Voice of Customer) Types
// ============================================================================

export type VocSentiment =
  | 'voc_positive' // Praise, success stories, "loving it"
  | 'voc_feedback' // Suggestions, critiques, feature requests
  | 'voc_blocker' // "Too busy", "haven't started", obstacles
  | 'voc_testimonial_candidate' // Compelling quotes worth expanding

export interface VocAnalysis {
  sentiment: VocSentiment
  confidence: number
  themes: string[] // e.g., ["course_quality", "time_constraints", "ai_interest"]
  quotableExcerpt?: string // Best quote for testimonial use
  shouldRequestExpansion: boolean
  expansionReason?: string // Why this is worth following up
}

// ============================================================================
// Step 1: Classify
// ============================================================================

/** Single message input (v2 - backwards compatible) */
export interface ClassifyInput {
  subject: string
  body: string
  from?: string
  conversationId?: string
  appId?: string
}

// ============================================================================
// Thread-based types (v3)
// ============================================================================

/** Author type for thread messages */
export type MessageAuthorType = 'customer' | 'teammate' | 'agent' | 'instructor'

/** Author info attached to thread messages */
export interface ThreadMessageAuthor {
  type: MessageAuthorType
  email: string
  name?: string
  teammateId?: string // Front teammate ID if applicable
}

/** A single message within a thread */
export interface ThreadMessage {
  direction: 'in' | 'out'
  body: string
  timestamp: number
  subject?: string // Usually only on first message
  author?: ThreadMessageAuthor
}

/** Thread-based input for classification (v3) */
export interface ThreadClassifyInput {
  conversationId: string
  appId: string
  messages: ThreadMessage[] // Full thread, chronological
  triggerMessage: ThreadMessage // The message that triggered processing
  instructorTeammateId?: string // From app config, for detection
  tags?: string[] // Front tags for rule-based classification
}

/** Thread-level signals for classification */
export interface ThreadSignals extends MessageSignals {
  // Thread structure
  threadLength: number // Total messages
  threadDurationHours: number // First to last message
  customerMessageCount: number // Inbound from customers
  teammateMessageCount: number // Outbound from human teammates
  agentMessageCount: number // Outbound from agent/API
  lastMessageDirection: 'in' | 'out'
  threadPattern: string // e.g., "in-out-in" for back-and-forth

  // Resolution signals
  hasThankYou: boolean // Customer thanked us
  hasResolutionPhrase: boolean // "that worked", "all set", etc.
  awaitingCustomerReply: boolean // We asked a question, no reply yet

  // Teammate/author signals
  hasTeammateMessage: boolean // Human teammate responded (not agent)
  hasRecentTeammateResponse: boolean // Teammate responded after last customer msg
  hasInstructorMessage: boolean // Instructor participated
  instructorIsAuthor: boolean // Thread started BY instructor
  isInternalThread: boolean // Only teammates, no customers
  lastResponderType: MessageAuthorType
}

/** Output for thread classification */
export interface ThreadClassifyOutput {
  category: MessageCategory
  confidence: number
  signals: ThreadSignals
  reasoning?: string
}

export interface ClassifyOutput {
  category: MessageCategory
  confidence: number // 0-1
  signals: MessageSignals
  reasoning?: string
}

export interface MessageSignals {
  hasEmailInBody: boolean
  hasPurchaseDate: boolean
  hasErrorMessage: boolean
  isReply: boolean
  mentionsInstructor: boolean
  hasAngrySentiment: boolean
  isAutomated: boolean
  isVendorOutreach: boolean
  // Escalation signals
  hasLegalThreat: boolean // "lawyer", "legal action", "sue", etc.
  hasOutsidePolicyTimeframe: boolean // mentions purchasing > 30 days ago
  isPersonalToInstructor: boolean // casual/personal message to instructor
  // Presales signals
  isPresalesFaq: boolean // pricing, curriculum, requirements, discounts
  isPresalesTeam: boolean // enterprise/team sales inquiries
}

// ============================================================================
// Step 2: Route
// ============================================================================

export interface RouteInput {
  message: ClassifyInput
  classification: ClassifyOutput
  appConfig: AppConfig
}

export interface RouteOutput {
  action: RouteAction
  reason: string
}

export interface AppConfig {
  appId: string
  instructorTeammateId?: string // Front teammate ID for routing
  instructorConfigured: boolean
  autoSendEnabled: boolean
  escalationRules?: EscalationRule[]
}

export interface EscalationRule {
  condition: string // e.g., "category == 'support_refund' && amount > 500"
  action: RouteAction
  reason: string
}

// ============================================================================
// Step 3: Gather
// ============================================================================

export interface GatherInput {
  message: ClassifyInput
  classification: ClassifyOutput
  appId: string
}

export interface GatherOutput {
  user: User | null
  purchases: Purchase[]
  knowledge: KnowledgeItem[]
  history: ConversationMessage[]
  priorMemory: MemoryItem[]
  gatherErrors: GatherError[] // Track failures internally, never expose
}

export interface User {
  id: string
  email: string
  name?: string
  createdAt?: string
}

export interface Purchase {
  id: string
  productId: string
  productName: string
  purchasedAt: string
  amount?: number
  status: 'active' | 'refunded' | 'transferred'
}

export interface KnowledgeItem {
  id: string
  type: 'faq' | 'article' | 'similar_ticket' | 'good_response'
  content: string
  relevance: number
  source?: string
}

export interface ConversationMessage {
  direction: 'in' | 'out'
  body: string
  timestamp: number
  author?: string
}

export interface MemoryItem {
  id: string
  content: string
  tags: string[]
  relevance: number
}

export interface GatherError {
  step: 'user' | 'purchases' | 'knowledge' | 'history' | 'memory'
  error: string
  // Never exposed to draft - just for debugging
}

// ============================================================================
// Step 4: Draft
// ============================================================================

export interface DraftInput {
  message: ClassifyInput
  classification: ClassifyOutput
  context: GatherOutput
  promptOverride?: string
}

export interface DraftOutput {
  draft: string
  reasoning?: string
  toolsUsed: string[]
  durationMs: number
}

// ============================================================================
// Step 5: Validate
// ============================================================================

export interface ValidateInput {
  draft: string
  context: GatherOutput
  strictMode?: boolean
}

export interface ValidateOutput {
  valid: boolean
  issues: ValidationIssue[]
  suggestion?: string
}

export interface ValidationIssue {
  type: ValidationIssueType
  severity: 'error' | 'warning'
  message: string
  match?: string
  position?: number
}

export type ValidationIssueType =
  | 'internal_leak'
  | 'meta_commentary'
  | 'banned_phrase'
  | 'fabrication'
  | 'too_short'
  | 'too_long'
  | 'bad_tone'
  | 'repeated_mistake' // Draft may repeat a known corrected mistake

// ============================================================================
// Step 5b: Comment (for support_teammate action)
// ============================================================================

export interface CommentInput {
  conversationId: string
  context: GatherOutput
  appId: string
}

export interface CommentOutput {
  added: boolean
  commentId?: string
  error?: string
}

// ============================================================================
// Step 6: Send
// ============================================================================

export interface SendInput {
  conversationId: string
  draft: string
  appId: string
}

export interface SendOutput {
  sent: boolean
  messageId?: string
  error?: string
}

// ============================================================================
// Pipeline orchestration
// ============================================================================

export interface PipelineInput {
  message: ClassifyInput
  appConfig: AppConfig
  dryRun?: boolean
}

export interface PipelineOutput {
  action: RouteAction
  response?: string
  sent?: boolean
  messageId?: string
  steps: PipelineStepResult[]
  totalDurationMs: number
}

export interface PipelineStepResult {
  step: 'classify' | 'route' | 'gather' | 'draft' | 'validate' | 'send'
  durationMs: number
  success: boolean
  output: unknown
  error?: string
}

// ============================================================================
// Eval types
// ============================================================================

export interface EvalScenario<TInput, TExpected> {
  id: string
  name: string
  input: TInput
  expected: TExpected
  tags?: string[]
}

export interface EvalResult<TOutput> {
  scenarioId: string
  passed: boolean
  actual: TOutput
  durationMs: number
  errors: string[]
}

export interface EvalSummary {
  total: number
  passed: number
  failed: number
  passRate: number
  durationMs: number
  byTag?: Record<string, { passed: number; failed: number }>
}
