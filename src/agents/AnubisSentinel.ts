/**
 * H.A.R.P.™ — Anubis Sentinel: Validation / Risk / Security Monitoring.
 *
 * Operates in adversarial review mode for high-risk tasks (AIOS §6.6): it
 * assumes the implementation may be wrong, the approval path unsafe, and the
 * context possibly poisoned. It marks security-sensitive work as requiring
 * approval and never rubber-stamps high-risk tasks.
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

export class AnubisSentinel extends HarpAgent {
  protected override artifactType(): ArtifactType {
    return "risk_report";
  }

  protected override temperature(): number {
    return TEMPERATURE.securityReview;
  }

  protected override buildResult(
    output: ModelOutput,
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
  ): AgentResult {
    const adversarial =
      context.task.riskLevel === "high" ||
      context.task.riskLevel === "critical";

    const risks = [...output.risks];
    if (
      context.task.requiresRepoWrite ||
      context.task.touchesSecrets ||
      adversarial
    ) {
      risks.push(
        "Security-sensitive or state-changing work: human approval required before execution.",
      );
    }

    const artifact = this.makeArtifact(
      {
        title: "Anubis Sentinel Risk & Security Review",
        content: [
          "Validation / Risk / Security Monitoring",
          adversarial ? "(adversarial review mode)" : "",
          "",
          "Risks:",
          ...risks.map((r) => `- ${r}`),
          "",
          "Findings:",
          ...output.findings.map((f) => `- ${f}`),
        ]
          .filter(Boolean)
          .join("\n"),
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
      risks,
      recommendations: output.recommendations,
      artifacts: [artifact],
      // Anubis flags security-sensitive actions as approval-requiring.
      approvalRequired: adversarial || risks.length > output.risks.length,
      unknowns: output.unknowns,
      nextSafeStep: output.nextSafeStep,
      assumptions: output.assumptions,
    };
  }
}
