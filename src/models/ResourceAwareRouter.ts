/**
 * H.A.R.P.™ — Resource-aware model routing & fan-out controls.
 *
 * A policy layer that decides WHICH model class a unit of work should use, so
 * not every task burns a frontier model. It implements the source material's
 * "fan-out" idea: cheap, fast models for token-heavy extraction/research, and
 * expensive reasoning models reserved for final synthesis — while never
 * downgrading high-risk work (consistent with the concierge's no-silent-
 * downgrade rule).
 *
 * This is a CONTROL SURFACE. It returns a routing decision; it does not call a
 * model. The concierge/ModelRouter still own delivery. Decisions are pure and
 * fully testable.
 */

import type { Observability } from "../observability/types.js";

export type WorkKind =
  | "extraction" // token-heavy, low-judgement → cheap/fast
  | "research" // broad gathering → cheap/fast
  | "review" // code/architecture review → coding/reasoning
  | "synthesis" // final reasoning/decision → reasoning/frontier
  | "security" // risk/security validation → reasoning/specialist
  | "boilerplate"; // trivial generation → fast

export type ModelClass =
  | "local-fast"
  | "local-reasoning"
  | "cloud-fast"
  | "cloud-reasoning"
  | "cloud-coding"
  | "frontier-reasoning"
  | "security-specialist"
  | "long-context";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RoutingDecision {
  modelClass: ModelClass;
  rationale: string;
  /** True when risk forced an upgrade over the cost-optimal choice. */
  upgradedForRisk: boolean;
}

export interface FanOutPlan {
  /** Cheap workers that gather/extract in parallel. */
  workers: { kind: WorkKind; modelClass: ModelClass; count: number };
  /** The single expensive synthesis step over worker outputs. */
  synthesis: { modelClass: ModelClass };
}

export interface ResourceRouterOptions {
  /** Cap on parallel cheap workers in a fan-out. */
  maxFanOut?: number;
  obs?: Observability;
}

export class ResourceAwareRouter {
  private readonly maxFanOut: number;
  private readonly obs?: Observability;

  constructor(options: ResourceRouterOptions = {}) {
    this.maxFanOut = options.maxFanOut ?? 5;
    this.obs = options.obs;
  }

  /** Cost-optimal class for a kind of work, before risk adjustment. */
  private baseClassFor(kind: WorkKind): ModelClass {
    switch (kind) {
      case "extraction":
      case "research":
        return "cloud-fast";
      case "boilerplate":
        return "local-fast";
      case "review":
        return "cloud-coding";
      case "security":
        return "cloud-reasoning";
      case "synthesis":
        return "cloud-reasoning";
    }
  }

  /**
   * Decide the model class for a unit of work. High/critical risk upgrades to a
   * stronger class and NEVER downgrades — mirroring the gateway's policy.
   */
  route(input: { kind: WorkKind; risk: RiskLevel }): RoutingDecision {
    const base = this.baseClassFor(input.kind);
    let chosen = base;
    let upgraded = false;

    if (input.risk === "high" || input.risk === "critical") {
      // Upgrade reasoning-bearing work to frontier; security to specialist.
      if (input.kind === "security") {
        chosen = "security-specialist";
      } else if (input.kind === "synthesis" || input.kind === "review") {
        chosen = "frontier-reasoning";
      }
      upgraded = chosen !== base;
    }

    const decision: RoutingDecision = {
      modelClass: chosen,
      upgradedForRisk: upgraded,
      rationale: upgraded
        ? `Upgraded ${input.kind} from ${base} to ${chosen} for ${input.risk} risk.`
        : `Cost-optimal ${chosen} for ${input.kind} at ${input.risk} risk.`,
    };

    this.obs?.meter.counter("router.decision").add(1, {
      kind: input.kind,
      risk: input.risk,
      modelClass: chosen,
      upgraded,
    });

    return decision;
  }

  /**
   * Build a fan-out plan: N cheap workers for token-heavy work, one expensive
   * synthesis over their results. Worker count is clamped to maxFanOut.
   */
  planFanOut(input: {
    workerKind: WorkKind;
    desiredWorkers: number;
    risk: RiskLevel;
  }): FanOutPlan {
    const count = Math.max(1, Math.min(this.maxFanOut, input.desiredWorkers));
    const workerClass = this.route({
      kind: input.workerKind,
      risk: "low", // workers do low-judgement gathering
    }).modelClass;
    const synthesisClass = this.route({
      kind: "synthesis",
      risk: input.risk,
    }).modelClass;

    this.obs?.meter.counter("router.fanout").add(1, {
      workers: count,
      workerClass,
      synthesisClass,
    });

    return {
      workers: { kind: input.workerKind, modelClass: workerClass, count },
      synthesis: { modelClass: synthesisClass },
    };
  }
}
