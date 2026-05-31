/**
 * H.A.R.P.™ — Stub model provider.
 *
 * Returns deterministic, schema-valid JSON so the whole orchestration can run
 * and be tested without a network call. Crucially, it emits the SAME JSON
 * shape that agents expect to parse, so the agent layer exercises its real
 * parsing path rather than a special-cased stub path.
 *
 * Replace with OpenAI / Anthropic / Gemini / Ollama / vLLM providers behind
 * the same ModelProvider interface.
 */

import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../core/types.js";

interface StubPayload {
  summary: string;
  findings: string[];
  risks: string[];
  recommendations: string[];
  unknowns: string[];
  nextSafeStep: string;
  assumptions: string[];
  filesAffected?: string[];
  testPlan?: string[];
  rollbackPlan?: string[];
  validationCommands?: string[];
}

export class StubModelProvider implements ModelProvider {
  readonly name = "stub";

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const start = Date.now();
    const isRa = request.agentId === "ra";

    const payload: StubPayload = {
      summary: `Stub ${request.modelClass} response for agent ${
        request.agentId ?? "unknown"
      }.`,
      findings: [
        "Context was received and parsed.",
        "No live model is connected; this is deterministic stub output.",
      ],
      risks: isRa
        ? ["Generated code must pass review and approval before any repo write."]
        : [],
      recommendations: [
        "Replace StubModelProvider with a real provider before production.",
      ],
      unknowns: ["Real model judgement is unavailable in stub mode."],
      nextSafeStep:
        "Connect a real ModelProvider, then re-run the workflow under approval gates.",
      assumptions: ["Stub mode assumes no external model access."],
    };

    if (isRa) {
      payload.filesAffected = ["(proposal only — no files written)"];
      payload.testPlan = [
        "Add unit tests covering the proposed change.",
        "Run pnpm run typecheck and pnpm test.",
      ];
      payload.rollbackPlan = [
        "Revert the proposal branch; no production state is touched.",
      ];
      payload.validationCommands = [
        "pnpm install",
        "pnpm run typecheck",
        "pnpm run build",
        "pnpm test",
      ];
    }

    const text = JSON.stringify(payload);
    const inputTokens = Math.ceil(
      (request.systemPrompt.length + request.userPrompt.length) / 4,
    );
    const outputTokens = Math.ceil(text.length / 4);

    return {
      text,
      modelUsed: `stub:${request.modelClass}`,
      modelClass: request.modelClass,
      inputTokens,
      outputTokens,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - start,
    };
  }
}
