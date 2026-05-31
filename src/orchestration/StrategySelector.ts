/**
 * H.A.R.P.™ — Strategy selection (AIOS §5.3, §5.4).
 *
 * Pharaoh does not use one fixed workflow. The selector scores candidate
 * strategies on cost, time, quality, risk, and approval burden, then applies
 * the §5.4 preference rule: safety outranks speed; quality outranks cost for
 * high-risk tasks; cost may outrank frontier usage for simple tasks.
 */

import { RISK_WEIGHT } from "../core/constants.js";
import type { AgentTask, CoordinationStrategyName } from "../core/types.js";
import type { CoordinationStrategy } from "./strategies/CoordinationStrategy.js";
import {
  ArbitrationStrategy,
  EscalationStrategy,
  NegotiationStrategy,
  ParallelReviewStrategy,
  SequentialReviewStrategy,
  VotingStrategy,
} from "./strategies/strategies.js";

export interface StrategyScore {
  estimatedTokenCost: number;
  estimatedRuntimeMs: number;
  expectedQuality: number; // 0..1
  expectedRisk: number; // 0..1 (lower is better)
  approvalBurden: number; // 0..1
}

export interface StrategyEvaluation {
  strategy: CoordinationStrategy;
  score: StrategyScore;
  composite: number;
  rationale: string;
}

const APPROX_TOKENS_PER_AGENT_STEP = 4_000;
const APPROX_MS_PER_AGENT_STEP = 1_500;

export class StrategySelector {
  private readonly candidates: CoordinationStrategy[] = [
    new SequentialReviewStrategy(),
    new ParallelReviewStrategy(),
    new ArbitrationStrategy(),
    new NegotiationStrategy(),
    new VotingStrategy(),
    new EscalationStrategy(),
  ];

  /** Returns the chosen strategy plus the full scored ranking for audit. */
  select(task: AgentTask): {
    chosen: CoordinationStrategy;
    ranking: StrategyEvaluation[];
    rationale: string;
  } {
    // Hard routing rules (AIOS §5.2 "Escalation") take precedence over scoring.
    const forceEscalation =
      task.riskLevel === "critical" ||
      task.touchesSecrets === true ||
      task.reversible === false;

    const ranking = this.candidates
      .map((strategy) => this.evaluate(strategy, task))
      .sort((a, b) => b.composite - a.composite);

    if (forceEscalation) {
      const escalation = ranking.find(
        (e) => e.strategy.name === "escalation",
      )!;
      return {
        chosen: escalation.strategy,
        ranking,
        rationale:
          "Forced escalation: critical risk, secrets involvement, or irreversible action.",
      };
    }

    const best = ranking[0]!;
    return {
      chosen: best.strategy,
      ranking,
      rationale: best.rationale,
    };
  }

  private evaluate(
    strategy: CoordinationStrategy,
    task: AgentTask,
  ): StrategyEvaluation {
    const steps = strategy.selectSequence({ task }).length;
    const riskW = RISK_WEIGHT[task.riskLevel];

    const estimatedTokenCost = steps * APPROX_TOKENS_PER_AGENT_STEP;
    const estimatedRuntimeMs = steps * APPROX_MS_PER_AGENT_STEP;

    // Heuristic quality: more review steps → higher quality, with diminishing
    // returns. Sequential review (7 steps) tops out near 1.0.
    const expectedQuality = Math.min(1, 0.45 + steps * 0.08);

    // Residual risk: strategies with both reviewers covering Ra output reduce
    // risk most. Escalation has lowest residual risk because it defers.
    const coversBuildReview = this.coversPostBuildReview(strategy);
    const expectedRisk = this.residualRisk(strategy, riskW, coversBuildReview);

    // Approval burden grows with steps and risk.
    const approvalBurden = Math.min(1, (steps / 7) * (riskW / 4));

    const score: StrategyScore = {
      estimatedTokenCost,
      estimatedRuntimeMs,
      expectedQuality,
      expectedRisk,
      approvalBurden,
    };

    // Composite weighting implements §5.4: safety first, then quality (scaled
    // by risk), then cost/time (cheaper/faster is mildly better).
    const safetyWeight = 0.45;
    const qualityWeight = 0.2 + (riskW / 4) * 0.2; // quality matters more at high risk
    const costWeight = 0.15 * (1 - riskW / 4); // cost matters less at high risk
    const timeWeight = 0.05;

    const normCost = 1 - Math.min(1, estimatedTokenCost / (7 * APPROX_TOKENS_PER_AGENT_STEP));
    const normTime = 1 - Math.min(1, estimatedRuntimeMs / (7 * APPROX_MS_PER_AGENT_STEP));

    const composite =
      safetyWeight * (1 - expectedRisk) +
      qualityWeight * expectedQuality +
      costWeight * normCost +
      timeWeight * normTime -
      0.05 * approvalBurden;

    return {
      strategy,
      score,
      composite,
      rationale: this.rationaleFor(strategy.name, task),
    };
  }

  private coversPostBuildReview(strategy: CoordinationStrategy): boolean {
    const seq = strategy.selectSequence({ task: {} as AgentTask });
    const raIndex = seq.indexOf("ra");
    if (raIndex === -1) {
      return false;
    }
    // Is there a reviewer after Ra?
    return seq
      .slice(raIndex + 1)
      .some((id) => id === "horus-nexus" || id === "anubis-sentinel");
  }

  private residualRisk(
    strategy: CoordinationStrategy,
    riskWeight: number,
    coversBuildReview: boolean,
  ): number {
    const base = riskWeight / 4; // 0.25..1
    let mitigation = 0;
    if (strategy.name === "sequential-review") mitigation = 0.5;
    else if (strategy.name === "escalation") mitigation = 0.6;
    else if (coversBuildReview) mitigation = 0.35;
    else mitigation = 0.2;
    return Math.max(0, base * (1 - mitigation));
  }

  private rationaleFor(
    name: CoordinationStrategyName,
    task: AgentTask,
  ): string {
    const map: Record<CoordinationStrategyName, string> = {
      "sequential-review":
        "Ordered review-build-validate loop; best safety/quality for risky or production-impacting work.",
      "parallel-review":
        "Independent reviewer assessment for fast, broad triage of lower-risk work.",
      arbitration:
        "Pharaoh arbitrates conflicting reviewer recommendations.",
      negotiation:
        "Reviewers reconcile tradeoffs over multiple rounds for design decisions.",
      voting:
        "Multiple candidate solutions weighed for low-risk implementation choices.",
      escalation:
        "Risk/uncertainty exceeds threshold; assess then defer to human approval.",
    };
    return `${map[name]} (task risk: ${task.riskLevel})`;
  }
}
