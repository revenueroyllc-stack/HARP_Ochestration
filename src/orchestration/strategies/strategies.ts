/**
 * H.A.R.P.™ — Concrete coordination strategies (AIOS §5.2).
 *
 * Six strategies satisfying the minimum required set. Each is a small, pure
 * planner. The orchestrator interprets the returned sequence; strategies that
 * conceptually run agents "in parallel" (parallel/voting) still return an
 * ordering — the orchestrator may parallelise independent reads where safe
 * (AIOS §19.3), but ordering remains the contract.
 */

import type {
  AgentId,
  AgentResult,
  CoordinationStrategyName,
} from "../../core/types.js";
import type {
  CoordinationStrategy,
  StrategyInput,
  WorkflowState,
} from "./CoordinationStrategy.js";

/** Stop helper: any agent blocked or failed ends the workflow. */
function anyBlockedOrFailed(results: AgentResult[]): boolean {
  return results.some((r) => r.status === "blocked" || r.status === "failed");
}

/**
 * Sequential Review — the canonical full loop. Used for architecture changes,
 * security-sensitive work, and production-impacting changes.
 */
export class SequentialReviewStrategy implements CoordinationStrategy {
  readonly name: CoordinationStrategyName = "sequential-review";

  selectSequence(): AgentId[] {
    return [
      "pharaoh",
      "horus-nexus",
      "anubis-sentinel",
      "ra",
      "horus-nexus",
      "anubis-sentinel",
      "pharaoh",
    ];
  }

  shouldStop(state: WorkflowState): boolean {
    return state.blockedForApproval || anyBlockedOrFailed(state.results);
  }
}

/**
 * Parallel Review — Pharaoh frames, Horus and Anubis review independently,
 * Pharaoh reconciles. Best for fast triage and broad assessment.
 */
export class ParallelReviewStrategy implements CoordinationStrategy {
  readonly name: CoordinationStrategyName = "parallel-review";

  selectSequence(): AgentId[] {
    return ["pharaoh", "horus-nexus", "anubis-sentinel", "pharaoh"];
  }

  shouldStop(state: WorkflowState): boolean {
    return anyBlockedOrFailed(state.results);
  }
}

/**
 * Arbitration — used when reviewers may disagree and Pharaoh must decide.
 * Same reviewers, but the closing Pharaoh pass is an explicit arbitration.
 */
export class ArbitrationStrategy implements CoordinationStrategy {
  readonly name: CoordinationStrategyName = "arbitration";

  selectSequence(): AgentId[] {
    return ["pharaoh", "horus-nexus", "anubis-sentinel", "pharaoh"];
  }
}

/**
 * Negotiation — reviewers reconcile tradeoffs across two rounds before Pharaoh
 * settles. Best for architecture / build-vs-buy / roadmap tradeoffs.
 */
export class NegotiationStrategy implements CoordinationStrategy {
  readonly name: CoordinationStrategyName = "negotiation";

  selectSequence(): AgentId[] {
    return [
      "pharaoh",
      "horus-nexus",
      "anubis-sentinel",
      "horus-nexus",
      "pharaoh",
    ];
  }
}

/**
 * Voting — multiple candidate solutions exist; Ra proposes options, reviewers
 * weigh in, Pharaoh tallies. Best for low-risk implementation alternatives.
 */
export class VotingStrategy implements CoordinationStrategy {
  readonly name: CoordinationStrategyName = "voting";

  selectSequence(): AgentId[] {
    return ["pharaoh", "ra", "horus-nexus", "anubis-sentinel", "pharaoh"];
  }
}

/**
 * Escalation — uncertainty or risk exceeds threshold. Minimal autonomous work:
 * Pharaoh frames, Anubis assesses risk, Pharaoh escalates to a human.
 */
export class EscalationStrategy implements CoordinationStrategy {
  readonly name: CoordinationStrategyName = "escalation";

  selectSequence(): AgentId[] {
    return ["pharaoh", "anubis-sentinel", "pharaoh"];
  }

  shouldStop(state: WorkflowState): boolean {
    // Escalation always defers to human approval after risk assessment.
    return state.blockedForApproval;
  }
}

export const ALL_STRATEGIES: readonly CoordinationStrategy[] = [
  new SequentialReviewStrategy(),
  new ParallelReviewStrategy(),
  new ArbitrationStrategy(),
  new NegotiationStrategy(),
  new VotingStrategy(),
  new EscalationStrategy(),
];
