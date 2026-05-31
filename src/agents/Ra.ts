/**
 * H.A.R.P.™ — Ra: Generation / Creation / Scheduling / Automation.
 *
 * Ra produces implementation PROPOSALS only — never an automatically committed
 * patch. Its output always carries a test plan, rollback plan, and validation
 * commands, and always requires approval before any repo write.
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
  filesAffected?: string[];
  testPlan?: string[];
  rollbackPlan?: string[];
  validationCommands?: string[];
}

export class Ra extends HarpAgent {
  protected override artifactType(): ArtifactType {
    return "code";
  }

  protected override temperature(): number {
    return TEMPERATURE.implementation;
  }

  protected override buildResult(
    output: ModelOutput,
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
  ): AgentResult {
    const testPlan = output.testPlan ?? [
      "Add unit tests for the proposed change.",
    ];
    const rollbackPlan = output.rollbackPlan ?? [
      "Revert the proposal branch; no production state is touched.",
    ];
    const validationCommands = output.validationCommands ?? [
      "pnpm install",
      "pnpm run typecheck",
      "pnpm run build",
      "pnpm test",
    ];
    const filesAffected = output.filesAffected ?? ["(proposal only)"];

    const artifact = this.makeArtifact(
      {
        title: "Ra Implementation Proposal",
        content: [
          "Generation / Creation / Scheduling / Automation",
          "",
          "This is an implementation PROPOSAL, not a committed patch.",
          "",
          "Summary:",
          output.summary,
          "",
          "Files affected:",
          ...filesAffected.map((f) => `- ${f}`),
          "",
          "Test plan:",
          ...testPlan.map((t) => `- ${t}`),
          "",
          "Rollback plan:",
          ...rollbackPlan.map((r) => `- ${r}`),
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
      risks: [
        ...output.risks,
        "Generated code must pass review and approval before any repo write.",
      ],
      recommendations: output.recommendations,
      artifacts: [artifact],
      approvalRequired: true, // Ra output ALWAYS requires approval.
      unknowns: output.unknowns,
      nextSafeStep: output.nextSafeStep,
      assumptions: output.assumptions,
      codeWork: {
        filesAffected,
        testPlan,
        rollbackPlan,
        validationCommands,
      },
    };
  }
}
