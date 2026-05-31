/**
 * H.A.R.P.™ — Advanced coordination strategies (SCAFFOLDED, GATED, DISABLED).
 *
 * These implement the CoordinationStrategy contract so they are first-class,
 * registrable strategies — but each is wrapped by the StrategyActivationPolicy
 * and will NOT yield an executable sequence unless explicitly activated AND
 * real-model validation is confirmed. On a stub provider they stay inert.
 *
 * Each strategy documents:
 *   - its coordination contract (what it would do with a real model),
 *   - the audit events it emits,
 *   - its fallback behaviour when activation is refused (fall back to the safe
 *     sequential-review path; never fail open into unvalidated behaviour).
 *
 * This is the "control surface now, intelligence later" boundary: the
 * architecture supports these patterns, gated and auditable, without running
 * unvalidated coordination logic.
 */

import type {
  AgentId,
  CoordinationStrategyName,
} from "../../../core/types.js";
import type {
  CoordinationStrategy,
  StrategyInput,
  WorkflowState,
} from "../CoordinationStrategy.js";
import {
  StrategyActivationPolicy,
  type AdvancedStrategyName,
} from "./ActivationPolicy.js";

/** Safe fallback sequence used whenever an advanced strategy is not activated. */
const SAFE_FALLBACK: AgentId[] = [
  "pharaoh",
  "horus-nexus",
  "anubis-sentinel",
  "ra",
  "horus-nexus",
  "anubis-sentinel",
  "pharaoh",
];

/** Audit-event action names each advanced strategy may emit (schema anchor). */
export const ADVANCED_STRATEGY_AUDIT_ACTIONS = {
  debatesSpawned: "strategy.debates.spawned",
  debatesConsensus: "strategy.debates.consensus",
  coalitionFormed: "strategy.coalition.formed",
  aufhebenSynthesis: "strategy.aufheben.synthesis",
  fellBackToSafe: "strategy.fell_back_to_safe",
} as const;

abstract class GatedAdvancedStrategy implements CoordinationStrategy {
  abstract readonly name: CoordinationStrategyName;
  protected abstract readonly advancedName: AdvancedStrategyName;
  /** The sequence this strategy WOULD run if activated. Documented contract. */
  protected abstract activatedSequence(input: StrategyInput): AgentId[];

  constructor(protected readonly policy: StrategyActivationPolicy) {}

  /**
   * Returns the activated sequence only if policy allows; otherwise returns the
   * safe sequential-review fallback. Never fails open.
   */
  selectSequence(input: StrategyInput): AgentId[] {
    const verdict = this.policy.evaluate(this.advancedName);
    if (verdict.allowed) {
      return this.activatedSequence(input);
    }
    return [...SAFE_FALLBACK];
  }

  shouldStop(state: WorkflowState): boolean {
    return (
      state.blockedForApproval ||
      state.results.some((r) => r.status === "blocked" || r.status === "failed")
    );
  }

  /** True when this strategy is actually permitted to run its advanced path. */
  isActive(): boolean {
    return this.policy.evaluate(this.advancedName).allowed;
  }
}

/**
 * Chain of Debates — Pharaoh would spawn multiple reviewer instances to argue a
 * problem, then take the stochastic-consensus "mode" to filter outliers.
 * CONTRACT (when active): pharaoh → [horus ×N | anubis ×N] → pharaoh (consensus).
 * AUDIT: debatesSpawned, debatesConsensus.
 */
export class ChainOfDebatesStrategy extends GatedAdvancedStrategy {
  readonly name: CoordinationStrategyName = "arbitration";
  protected readonly advancedName: AdvancedStrategyName = "chain-of-debates";

  protected activatedSequence(): AgentId[] {
    // Multiple reviewer passes converging at Pharaoh. (Only used when active.)
    return [
      "pharaoh",
      "horus-nexus",
      "horus-nexus",
      "anubis-sentinel",
      "anubis-sentinel",
      "pharaoh",
    ];
  }
}

/**
 * Loose Coalitions — Pharaoh would form a sub-team by reliability/busyness/
 * satisfaction scores rather than a fixed roster.
 * CONTRACT (when active): pharaoh → dynamically selected coalition → pharaoh.
 * AUDIT: coalitionFormed.
 */
export class LooseCoalitionsStrategy extends GatedAdvancedStrategy {
  readonly name: CoordinationStrategyName = "negotiation";
  protected readonly advancedName: AdvancedStrategyName = "loose-coalitions";

  protected activatedSequence(): AgentId[] {
    // Placeholder coalition ordering; real selection needs live reliability data.
    return ["pharaoh", "horus-nexus", "anubis-sentinel", "pharaoh"];
  }
}

/**
 * Aufheben Dialectical Protocol — when Ra (thesis) and Anubis (antithesis)
 * conflict, Pharaoh would invoke a synthesis phase rather than picking a side.
 * CONTRACT (when active): pharaoh → ra → anubis → pharaoh (synthesis) → ...
 * AUDIT: aufhebenSynthesis.
 */
export class AufhebenStrategy extends GatedAdvancedStrategy {
  readonly name: CoordinationStrategyName = "negotiation";
  protected readonly advancedName: AdvancedStrategyName = "aufheben";

  protected activatedSequence(): AgentId[] {
    return [
      "pharaoh",
      "ra",
      "anubis-sentinel",
      "pharaoh",
      "horus-nexus",
      "pharaoh",
    ];
  }
}

/** Build the advanced strategy set, all sharing one activation policy. */
export function buildAdvancedStrategies(
  policy: StrategyActivationPolicy,
): GatedAdvancedStrategy[] {
  return [
    new ChainOfDebatesStrategy(policy),
    new LooseCoalitionsStrategy(policy),
    new AufhebenStrategy(policy),
  ];
}
