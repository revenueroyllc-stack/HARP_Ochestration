/**
 * H.A.R.P.™ — Gateway wire contracts.
 *
 * The single source of truth for the message envelope that crosses the
 * concierge ⇄ container boundary. Both sides import these types so the wire
 * format can never drift. NOTHING here references a concrete provider — the
 * contract is provider-agnostic by design.
 *
 * PII PRINCIPLE: the request envelope that travels over HTTP carries only
 * what a model needs to reason. The concierge runs redaction BEFORE building
 * this envelope, so by the time a payload reaches the wire it is already
 * scrubbed. See src/gateway/redaction.
 */

/** Model classes the core may request. Mirrors core ModelClass. */
export type WireModelClass =
  | "local-fast"
  | "local-reasoning"
  | "cloud-fast"
  | "cloud-reasoning"
  | "cloud-coding"
  | "frontier-reasoning"
  | "embedding"
  | "reranker"
  | "security-specialist"
  | "long-context";

/** Protocol version. Bumped on any breaking envelope change. */
export const WIRE_PROTOCOL_VERSION = "1.0.0" as const;

/**
 * The request the concierge delivers to a container. Already redacted.
 * `correlationId` lets both sides trace a single round trip in logs WITHOUT
 * logging payload contents.
 */
export interface ContainerRequest {
  protocolVersion: string;
  correlationId: string;
  modelClass: WireModelClass;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** True if the originating task is high-risk. Containers must not downgrade. */
  highRisk: boolean;
  /** Soft deadline in ms; container should abort and return a timeout error. */
  deadlineMs: number;
}

/** Discriminated result so failures are data, never thrown across the wire. */
export type ContainerResponse =
  | ContainerSuccess
  | ContainerFailure;

export interface ContainerSuccess {
  ok: true;
  protocolVersion: string;
  correlationId: string;
  text: string;
  modelUsed: string;
  modelClass: WireModelClass;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export type ContainerFailureKind =
  | "timeout"
  | "provider_error"
  | "overloaded"
  | "bad_request"
  | "unauthorized"
  | "internal";

export interface ContainerFailure {
  ok: false;
  protocolVersion: string;
  correlationId: string;
  kind: ContainerFailureKind;
  message: string;
  /** Whether the concierge may safely retry the same container. */
  retryable: boolean;
}

/** Health/identity a container advertises so the concierge can route. */
export interface ContainerDescriptor {
  /** Stable container id, e.g. "anthropic-primary". */
  id: string;
  /** Model classes this container can serve. */
  servesClasses: WireModelClass[];
  /** Logical class tier used for same-class failover. */
  tier: "primary" | "backup";
  /** Provider family label (for audit only, not for core logic). */
  providerFamily: string;
}

export interface HealthResponse {
  ok: boolean;
  descriptor: ContainerDescriptor;
  protocolVersion: string;
}
