/**
 * H.A.R.P.™ — Container routing & failover policy.
 *
 * Implements the operator-mandated tiered policy:
 *   retry same  →  same-class backup  →  report to core
 * with the hard rule: NEVER silently substitute a weaker model on high-risk
 * work. For high-risk requests, failover is permitted only to a container that
 * serves the SAME model class; if none is healthy, the concierge reports
 * failure to the core rather than downgrading.
 */

import type {
  ContainerDescriptor,
  WireModelClass,
} from "../contracts/wire.js";

export interface RegisteredContainer {
  descriptor: ContainerDescriptor;
  /** Base URL, e.g. "https://harp-anthropic-primary:8443". */
  baseUrl: string;
  /** Marked unhealthy by the concierge after repeated failures. */
  healthy: boolean;
}

export interface RoutePlan {
  /** Ordered list of containers to try. */
  attempts: RegisteredContainer[];
}

export interface RoutingOptions {
  /** Max attempts against the SAME container before moving on. */
  retriesPerContainer: number;
}

export class ContainerRegistry {
  private readonly containers: RegisteredContainer[] = [];

  register(entry: RegisteredContainer): void {
    if (this.containers.some((c) => c.descriptor.id === entry.descriptor.id)) {
      throw new Error(`Container already registered: ${entry.descriptor.id}`);
    }
    this.containers.push(entry);
  }

  all(): RegisteredContainer[] {
    return [...this.containers];
  }

  byId(id: string): RegisteredContainer | undefined {
    return this.containers.find((c) => c.descriptor.id === id);
  }

  markHealth(id: string, healthy: boolean): void {
    const c = this.byId(id);
    if (c) {
      c.healthy = healthy;
    }
  }

  /** Healthy containers that serve a given model class. */
  serving(modelClass: WireModelClass): RegisteredContainer[] {
    return this.containers.filter(
      (c) => c.healthy && c.descriptor.servesClasses.includes(modelClass),
    );
  }
}

export class Router {
  constructor(
    private readonly registry: ContainerRegistry,
    private readonly options: RoutingOptions = { retriesPerContainer: 2 },
  ) {}

  get retriesPerContainer(): number {
    return this.options.retriesPerContainer;
  }

  /**
   * Builds the ordered attempt plan for a request.
   *
   * Tiering:
   *  1. Primary container(s) for the class (tier "primary") first.
   *  2. Backup container(s) for the SAME class next.
   *
   * For high-risk requests, only same-class containers are ever included, so a
   * weaker/different class can never be substituted. (For non-high-risk, the
   * plan is still same-class only here — class substitution is intentionally
   * NOT performed at the transport layer; choosing a different class is a core
   * decision, not a silent concierge fallback.)
   */
  plan(modelClass: WireModelClass): RoutePlan {
    const serving = this.registry.serving(modelClass);

    const primaries = serving.filter((c) => c.descriptor.tier === "primary");
    const backups = serving.filter((c) => c.descriptor.tier === "backup");

    // Deterministic order: primaries, then backups. Within a tier, stable.
    const attempts = [...primaries, ...backups];

    return { attempts };
  }
}
