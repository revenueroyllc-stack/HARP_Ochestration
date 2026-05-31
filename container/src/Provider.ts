/**
 * H.A.R.P.™ Container — Provider interface (lives INSIDE the container).
 *
 * This is the only contract a real model integration must satisfy. The
 * provider lives and works entirely within the container; it owns API keys,
 * SDK calls, and network access to the upstream model. Neither the core nor
 * the concierge ever imports a provider — they only ever see redacted wire
 * messages and structured responses.
 */

import type {
  ContainerDescriptor,
  WireModelClass,
} from "../../src/gateway/contracts/wire.js";

export interface ProviderInput {
  modelClass: WireModelClass;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  highRisk: boolean;
  deadlineMs: number;
}

export interface ProviderOutput {
  text: string;
  modelUsed: string;
  modelClass: WireModelClass;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export interface ContainedProvider {
  readonly descriptor: ContainerDescriptor;
  generate(input: ProviderInput): Promise<ProviderOutput>;
}

/**
 * Stub provider that lives inside the container. Returns deterministic,
 * schema-shaped JSON so the FULL secure pipe (mTLS → container → provider →
 * back) can be exercised before any real model SDK is wired in. Swapping this
 * for an OpenAI/Anthropic/Ollama provider touches only this container, never
 * the concierge or core.
 */
export class StubContainedProvider implements ContainedProvider {
  readonly descriptor: ContainerDescriptor;

  constructor(descriptor: ContainerDescriptor) {
    this.descriptor = descriptor;
  }

  async generate(input: ProviderInput): Promise<ProviderOutput> {
    const start = Date.now();
    const payload = {
      summary: `Stub ${input.modelClass} response from container ${this.descriptor.id}.`,
      findings: [
        "Secure pipe exercised end to end.",
        "Provider executed inside its container.",
      ],
      risks: input.highRisk
        ? ["High-risk task: human approval required before execution."]
        : [],
      recommendations: ["Replace stub with a real model SDK inside this container."],
      unknowns: ["Real model judgement unavailable in stub mode."],
      nextSafeStep: "Wire a real provider; keep the concierge and core unchanged.",
      assumptions: ["Stub mode assumes no upstream model access."],
    };
    const text = JSON.stringify(payload);
    return {
      text,
      modelUsed: `stub:${this.descriptor.providerFamily}:${input.modelClass}`,
      modelClass: input.modelClass,
      inputTokens: Math.ceil(
        (input.systemPrompt.length + input.userPrompt.length) / 4,
      ),
      outputTokens: Math.ceil(text.length / 4),
      estimatedCostUsd: 0,
      latencyMs: Date.now() - start,
    };
  }
}
