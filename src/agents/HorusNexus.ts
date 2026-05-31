/**
 * H.A.R.P.™ — Horus Nexus: Observation / Review / Long-term Planning.
 */

import { TEMPERATURE } from "../core/constants.js";
import { HarpAgent } from "./BaseAgent.js";
import type {
  AgentResult,
  ArtifactType,
  ModelClass,
  ScopedContext,
} from "../core/types.js";

interface ModelOutput {
  summary: string;
  findings: string[];
  risks: string[];
  recommendations: string[];
  unknowns: string[];
  nextSafeStep: string;
  assumptions: string[];
}

export class HorusNexus extends HarpAgent {
  protected override artifactType(): ArtifactType {
    return "review";
  }

  protected override temperature(): number {
    return TEMPERATURE.codeReview;
  }

  protected override buildResult(
    output: ModelOutput,
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
  ): AgentResult {
    const artifact = this.makeArtifact(
      {
        title: "Horus Nexus Architecture Review",
        content: [
          "Observation / Review / Long-term Planning",
          "",
          "Findings:",
          ...output.findings.map((f) => `- ${f}`),
          "",
          "Recommendations:",
          ...output.recommendations.map((r) => `- ${r}`),
        ].join("\n"),
      },
      context,
      workflowId,
      modelClass,
    );

    // Horus reviews but never approves its own work.
    return {
      agentId: this.id,
      status: "success",
      summary: output.summary,
      findings: output.findings,
      risks: output.risks,
      recommendations: output.recommendations,
      artifacts: [artifact],
      approvalRequired: false,
      unknowns: output.unknowns,
      nextSafeStep: output.nextSafeStep,
      assumptions: output.assumptions,
    };
  }
}
