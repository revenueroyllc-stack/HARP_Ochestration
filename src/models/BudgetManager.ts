/**
 * H.A.R.P.™ — Budget hardening.
 *
 * Extends the single per-workflow token budget into a multi-scope manager
 * (per-agent, per-workflow, per-day) with two graded responses required by the
 * protocol (AIOS §13.5):
 *
 *   1. DOWNSHIFT — when a soft threshold is crossed, signal that the caller
 *      should drop to a cheaper model class rather than stop.
 *   2. CUTOFF — when a hard limit is reached, refuse further spend (fail
 *      closed) so a runaway workflow cannot rack up unbounded cost.
 *
 * This is a CONTROL SURFACE: it records spend and returns a verdict. It does
 * not call models. Verdicts are pure and testable.
 */

import type { Observability } from "../observability/types.js";

export type BudgetScope = "agent" | "workflow" | "day";

export interface BudgetLimits {
  /** Hard ceiling. Spend beyond this is refused. */
  hard: number;
  /** Soft threshold (≤ hard). Crossing it advises a downshift. */
  soft: number;
}

export type BudgetVerdict =
  | { decision: "ok"; remaining: number }
  | { decision: "downshift"; remaining: number; reason: string }
  | { decision: "cutoff"; remaining: 0; reason: string };

export interface BudgetConfig {
  agent?: BudgetLimits;
  workflow: BudgetLimits;
  day?: BudgetLimits;
  obs?: Observability;
}

interface ScopeState {
  limits: BudgetLimits;
  used: Map<string, number>;
}

export class BudgetManager {
  private readonly scopes: Partial<Record<BudgetScope, ScopeState>> = {};
  private readonly obs?: Observability;

  constructor(config: BudgetConfig) {
    this.obs = config.obs;
    this.scopes.workflow = { limits: config.workflow, used: new Map() };
    if (config.agent) {
      this.scopes.agent = { limits: config.agent, used: new Map() };
    }
    if (config.day) {
      this.scopes.day = { limits: config.day, used: new Map() };
    }
  }

  /**
   * Check whether `tokens` may be spent under a given key in each active scope,
   * WITHOUT recording. Returns the most restrictive verdict across scopes.
   */
  check(input: {
    tokens: number;
    workflowId: string;
    agentId?: string;
    day?: string;
  }): BudgetVerdict {
    const checks: { scope: BudgetScope; key: string }[] = [
      { scope: "workflow", key: input.workflowId },
    ];
    if (this.scopes.agent && input.agentId) {
      checks.push({ scope: "agent", key: input.agentId });
    }
    if (this.scopes.day) {
      checks.push({
        scope: "day",
        key: input.day ?? new Date().toISOString().slice(0, 10),
      });
    }

    let verdict: BudgetVerdict = { decision: "ok", remaining: Infinity };

    for (const { scope, key } of checks) {
      const state = this.scopes[scope];
      if (!state) continue;
      const used = state.used.get(key) ?? 0;
      const projected = used + input.tokens;
      const remaining = Math.max(0, state.limits.hard - used);

      if (projected > state.limits.hard) {
        return {
          decision: "cutoff",
          remaining: 0,
          reason: `${scope} budget hard limit reached (used ${used}, limit ${state.limits.hard}).`,
        };
      }
      if (projected > state.limits.soft && verdict.decision === "ok") {
        verdict = {
          decision: "downshift",
          remaining,
          reason: `${scope} budget soft threshold crossed; downshift recommended.`,
        };
      }
      if (verdict.decision === "ok") {
        verdict = { decision: "ok", remaining };
      }
    }

    return verdict;
  }

  /** Record actual spend across all active scopes. */
  record(input: {
    tokens: number;
    workflowId: string;
    agentId?: string;
    day?: string;
  }): void {
    const add = (scope: BudgetScope, key: string) => {
      const state = this.scopes[scope];
      if (!state) return;
      state.used.set(key, (state.used.get(key) ?? 0) + input.tokens);
    };
    add("workflow", input.workflowId);
    if (input.agentId) add("agent", input.agentId);
    add("day", input.day ?? new Date().toISOString().slice(0, 10));

    this.obs?.meter.counter("budget.tokens_spent").add(input.tokens, {
      workflowId: input.workflowId,
      agentId: input.agentId ?? "n/a",
    });
  }

  usage(scope: BudgetScope, key: string): number {
    return this.scopes[scope]?.used.get(key) ?? 0;
  }
}
