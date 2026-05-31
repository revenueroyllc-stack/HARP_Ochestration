/**
 * H.A.R.P.™ — Pharaoh: Executive Orchestrator + Knowledge Librarian.
 *
 * Pharaoh produces the final recommendation and enforces approval gates. It
 * never writes code, never performs final security signoff alone, and never
 * approves high-risk actions without human approval.
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

export class Pharaoh extends HarpAgent {
  protected override artifactType(): ArtifactType {
    return "final_report";
  }

  protected override temperature(): number {
    return TEMPERATURE.evaluation;
  }

  protected override buildResult(
    output: ModelOutput,
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
  ): AgentResult {
    const highRisk =
      context.task.riskLevel === "high" ||
      context.task.riskLevel === "critical";

    const artifact = this.makeArtifact(
      {
        title: "Pharaoh Final Recommendation",
        content: [
          "Executive orchestration complete.",
          "",
          "Pharaoh confirms the workflow proceeded through controlled review,",
          "validation, and approval gates.",
          "",
          "Summary:",
          output.summary,
          "",
          "Recommendations:",
          ...output.recommendations.map((r) => `- ${r}`),
        ].join("\n"),
      },
      context,
      workflowId,
      modelClass,
    );

    return {
      agentId: this.id,
      status: "success",
      summary: output.summary,
      findings: output.findings,
      risks: output.risks,
      recommendations: output.recommendations,
      artifacts: [artifact],
      approvalRequired: highRisk,
      unknowns: output.unknowns,
      nextSafeStep: output.nextSafeStep,
      assumptions: output.assumptions,
    };
  }
}
