/**
 * H.A.R.P.™ — Advanced strategy activation policy.
 *
 * Advanced coordination strategies (Chain of Debates, Loose Coalitions,
 * Aufheben) are SCAFFOLDED but DISABLED. This policy is the single gate that
 * decides whether one may execute. By default everything advanced is off.
 *
 * Two independent conditions must BOTH hold for an advanced strategy to run:
 *   1. Explicit config opt-in (HARP_ENABLE_ADVANCED_STRATEGIES=true plus the
 *      specific strategy named in HARP_ENABLED_STRATEGIES).
 *   2. Real-model validation confirmed (HARP_MODEL_VALIDATED=true) — because
 *      these strategies are meaningless and unvalidated on a stub provider.
 *
 * If either is missing, activation is refused and an audit event is emitted.
 * This lets the product truthfully say the patterns are "supported, gated, and
 * auditable" without ever running unvalidated coordination logic in production.
 */

import type { AuditLogger } from "../../../storage/AuditLogger.js";

export type AdvancedStrategyName =
  | "chain-of-debates"
  | "loose-coalitions"
  | "aufheben";

export interface ActivationVerdict {
  allowed: boolean;
  reason: string;
}

export class StrategyActivationPolicy {
  constructor(private readonly auditLogger?: AuditLogger) {}

  private enabledSet(): Set<string> {
    const raw = process.env.HARP_ENABLED_STRATEGIES ?? "";
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  /** Pure check (no audit) — usable in tests and previews. */
  evaluate(name: AdvancedStrategyName): ActivationVerdict {
    const globallyEnabled =
      (process.env.HARP_ENABLE_ADVANCED_STRATEGIES ?? "false").toLowerCase() ===
      "true";
    if (!globallyEnabled) {
      return {
        allowed: false,
        reason:
          "Advanced strategies are globally disabled (HARP_ENABLE_ADVANCED_STRATEGIES != true).",
      };
    }

    if (!this.enabledSet().has(name)) {
      return {
        allowed: false,
        reason: `Strategy "${name}" is not in HARP_ENABLED_STRATEGIES.`,
      };
    }

    const modelValidated =
      (process.env.HARP_MODEL_VALIDATED ?? "false").toLowerCase() === "true";
    if (!modelValidated) {
      return {
        allowed: false,
        reason:
          "Real-model validation not confirmed (HARP_MODEL_VALIDATED != true). " +
          "Advanced coordination is meaningless on a stub provider and stays gated.",
      };
    }

    return { allowed: true, reason: `Strategy "${name}" activated by explicit policy.` };
  }

  /** Check + emit an audit event for the decision. */
  async authorize(
    name: AdvancedStrategyName,
    context: { workflowId?: string; taskId?: string },
  ): Promise<ActivationVerdict> {
    const verdict = this.evaluate(name);
    await this.auditLogger?.write({
      actor: "system",
      action: verdict.allowed
        ? "strategy.activated"
        : "strategy.activation_refused",
      target: name,
      workflowId: context.workflowId,
      taskId: context.taskId,
      details: { reason: verdict.reason },
    });
    return verdict;
  }
}
