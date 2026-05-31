/**
 * H.A.R.P.™ — Coordination strategy interface (AIOS §4.3, §5).
 *
 * Polymorphic coordination. The orchestrator owns no fixed sequence; it asks a
 * CoordinationStrategy what to run next. Strategies are pure planners: they
 * decide agent ordering and stop conditions but never execute agents
 * themselves (that stays in the orchestrator).
 */

import type {
  AgentId,
  AgentResult,
  AgentTask,
  CoordinationStrategyName,
} from "../../core/types.js";

export interface StrategyInput {
  task: AgentTask;
}

/** Mutable view of progress, passed to shouldStop after each agent runs. */
export interface WorkflowState {
  task: AgentTask;
  completedAgents: AgentId[];
  results: AgentResult[];
  /** Set when an approval gate has blocked further progress. */
  blockedForApproval: boolean;
}

export interface CoordinationStrategy {
  readonly name: CoordinationStrategyName;
  /** The ordered agent sequence to execute. */
  selectSequence(input: StrategyInput): AgentId[];
  /** Optional early-stop check evaluated after each agent completes. */
  shouldStop?(state: WorkflowState): boolean;
}
