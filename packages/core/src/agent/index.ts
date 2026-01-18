/**
 * Agent module - Mastra-based agent logic for support system
 */

// Re-export the configured support agent
export { supportAgent } from './config'

// Re-export agent-relevant types for consumers
export type {
  ToolContext,
  ExecutionContext,
  ToolResult,
  SupportTool,
  InferToolParams,
  InferToolResult,
} from '../tools/types'
