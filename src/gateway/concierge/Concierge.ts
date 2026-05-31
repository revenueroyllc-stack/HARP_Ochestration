/**
 * H.A.R.P.™ — The Concierge.
 *
 * From the core's point of view the Concierge IS a ModelProvider: it exposes
 * the same `generate(request) → response` contract, so it drops into the
 * composition root with ZERO changes to core, agents, or the ModelRouter.
 *
 * Responsibilities (in order, per request):
 *   1. Redact PII from prompts BEFORE anything touches the wire.
 *   2. Plan a route (tiered: primary → same-class backup).
 *   3. Deliver to a container over mTLS HTTP.
 *   4. Apply tiered policy: retry same → same-class backup → report to core.
 *   5. Never silently substitute a weaker model on high-risk work.
 *   6. Map the container response back to the core ModelResponse shape.
 *
 * The Concierge holds NO provider logic and NO secrets. It only carries
 * (redacted) messages and brings back results.
 */

import { randomUUID } from "node:crypto";
import {
  WIRE_PROTOCOL_VERSION,
  type ContainerRequest,
  type ContainerResponse,
  type WireModelClass,
} from "../contracts/wire.js";
import type { Redactor } from "../redaction/Redactor.js";
import type { SafeLogger } from "../security/SafeLogger.js";
import {
  ContainerRegistry,
  Router,
  type RegisteredContainer,
} from "../routing/Router.js";

/** Mirrors the core ModelProvider contract (kept structural to avoid a hard import cycle). */
export interface CoreModelRequest {
  modelClass: WireModelClass;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  agentId?: string;
  taskId?: string;
  workflowId?: string;
  /** Optional high-risk hint from the core; defaults to false. */
  highRisk?: boolean;
}

export interface CoreModelResponse {
  text: string;
  modelUsed: string;
  modelClass: WireModelClass;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

/** Transport abstraction so mTLS HTTP can be swapped/mocked in tests. */
export interface ContainerTransport {
  deliver(
    container: RegisteredContainer,
    request: ContainerRequest,
  ): Promise<ContainerResponse>;
}

export class ConciergeError extends Error {
  constructor(
    message: string,
    readonly lastKind?: string,
  ) {
    super(message);
    this.name = "ConciergeError";
  }
}

export interface ConciergeOptions {
  deadlineMs?: number;
}

export class Concierge {
  readonly name = "concierge";
  private readonly deadlineMs: number;

  constructor(
    private readonly registry: ContainerRegistry,
    private readonly router: Router,
    private readonly transport: ContainerTransport,
    private readonly redactor: Redactor,
    private readonly logger: SafeLogger,
    options: ConciergeOptions = {},
  ) {
    this.deadlineMs = options.deadlineMs ?? 60_000;
  }

  async generate(request: CoreModelRequest): Promise<CoreModelResponse> {
    const correlationId = randomUUID();
    const highRisk = request.highRisk ?? false;

    // 1. Redact BEFORE building the wire envelope.
    const sys = this.redactor.redact(request.systemPrompt);
    const usr = this.redactor.redact(request.userPrompt);
    const redactions = [...sys.findings, ...usr.findings];

    this.logger.log({
      event: "concierge.request",
      correlationId,
      modelClass: request.modelClass,
      redactions: redactions.length ? redactions : undefined,
    });

    // 2. Plan the route (same-class only; tiered primary→backup).
    const plan = this.router.plan(request.modelClass);

    if (plan.attempts.length === 0) {
      this.logger.log({
        event: "concierge.no_route",
        correlationId,
        modelClass: request.modelClass,
        outcome: "failure",
      });
      throw new ConciergeError(
        `No healthy container serves model class "${request.modelClass}". ` +
          "Reporting to core rather than downgrading.",
        "no_route",
      );
    }

    const envelope: ContainerRequest = {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      correlationId,
      modelClass: request.modelClass,
      systemPrompt: sys.text,
      userPrompt: usr.text,
      temperature: request.temperature,
      highRisk,
      deadlineMs: this.deadlineMs,
    };

    let lastKind: string | undefined;

    // 3–5. Tiered delivery: for each container, retry on the same one, then
    // move to the next (same-class backup). High-risk never leaves the class
    // because the plan is same-class only.
    for (const container of plan.attempts) {
      for (
        let attempt = 1;
        attempt <= this.router.retriesPerContainer;
        attempt++
      ) {
        let response: ContainerResponse;
        try {
          response = await this.transport.deliver(container, envelope);
        } catch (error) {
          // Transport-level throw (connection refused, TLS failure, etc.).
          lastKind = "transport";
          this.logger.log({
            event: "concierge.transport_error",
            correlationId,
            containerId: container.descriptor.id,
            attempt,
            outcome: attempt < this.router.retriesPerContainer ? "retry" : "failover",
            failureKind: "transport",
          });
          continue;
        }

        if (response.ok) {
          this.logger.log({
            event: "concierge.success",
            correlationId,
            containerId: container.descriptor.id,
            modelClass: response.modelClass,
            outcome: "success",
            attempt,
            latencyMs: response.latencyMs,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
          });
          return {
            text: response.text,
            modelUsed: response.modelUsed,
            modelClass: response.modelClass,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            estimatedCostUsd: response.estimatedCostUsd,
            latencyMs: response.latencyMs,
          };
        }

        // Structured failure.
        lastKind = response.kind;

        if (response.kind === "unauthorized" || response.kind === "bad_request") {
          // Not retryable and not a health problem — surface immediately.
          this.logger.log({
            event: "concierge.fatal_failure",
            correlationId,
            containerId: container.descriptor.id,
            outcome: "failure",
            failureKind: response.kind,
            attempt,
          });
          throw new ConciergeError(
            `Container ${container.descriptor.id} returned ${response.kind}: ${response.message}`,
            response.kind,
          );
        }

        const willRetrySame =
          response.retryable && attempt < this.router.retriesPerContainer;

        this.logger.log({
          event: "concierge.container_failure",
          correlationId,
          containerId: container.descriptor.id,
          failureKind: response.kind,
          attempt,
          outcome: willRetrySame ? "retry" : "failover",
        });

        if (!willRetrySame) {
          // Repeated failure on this container → mark unhealthy, move to backup.
          this.registry.markHealth(container.descriptor.id, false);
          break;
        }
      }
    }

    // 6. All same-class containers exhausted → report to core. No downgrade.
    this.logger.log({
      event: "concierge.exhausted",
      correlationId,
      modelClass: request.modelClass,
      outcome: "failure",
      failureKind: lastKind,
    });
    throw new ConciergeError(
      `All containers for class "${request.modelClass}" failed (last: ${lastKind ?? "unknown"}). ` +
        "Reporting to core; no weaker model substituted.",
      lastKind,
    );
  }
}
