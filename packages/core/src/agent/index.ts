/**
 * Agent module - AI SDK-based agent logic for support system
 */

export {
  runSupportAgent,
  agentTools,
  SUPPORT_AGENT_PROMPT,
  type AgentInput,
  type AgentOutput,
} from './config'

// Re-export agent-relevant types for consumers
export type {
  ToolContext,
  ExecutionContext,
  ToolResult,
  SupportTool,
  InferToolParams,
  InferToolResult,
} from '../tools/types'
