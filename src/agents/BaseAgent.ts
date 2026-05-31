/**
 * H.A.R.P.™ — Base agent.
 *
 * The base agent builds a scoped prompt, requests a structured JSON response
 * from the model (via the router, never a provider directly), and parses that
 * response into the §26 AgentResult shape. Parsing is defensive: malformed
 * model output degrades to a safe, explicit "blocked" result rather than
 * throwing or fabricating findings.
 */

import { randomUUID } from "node:crypto";
import type { AgentConfig } from "../core/agentConfig.js";
import { TEMPERATURE } from "../core/constants.js";
import type { ModelRouter } from "../models/ModelRouter.js";
import type { AuditLogger } from "../storage/AuditLogger.js";
import type {
  AgentId,
  AgentResult,
  Artifact,
  ArtifactType,
  ModelClass,
  ScopedContext,
} from "../core/types.js";

/** The JSON contract the model is asked to satisfy. */
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

export interface AgentExecuteInput {
  task: { id: string };
  context: ScopedContext;
  workflowId: string;
}

export abstract class HarpAgent {
  constructor(
    protected readonly config: AgentConfig,
    protected readonly modelRouter: ModelRouter,
    protected readonly auditLogger: AuditLogger,
  ) {}

  get id(): AgentId {
    return this.config.id;
  }

  /** Artifact type this agent emits. */
  protected abstract artifactType(): ArtifactType;

  /** Phase-appropriate temperature (deterministic for review/security). */
  protected temperature(): number {
    return TEMPERATURE.codeReview;
  }

  /** Model class to use given the task risk level. */
  protected modelClassFor(context: ScopedContext): ModelClass {
    return context.task.riskLevel === "high" ||
      context.task.riskLevel === "critical"
      ? this.config.highRiskModel
      : this.config.preferredModel;
  }

  async execute(input: AgentExecuteInput): Promise<AgentResult> {
    const { context, workflowId } = input;

    await this.auditLogger.write({
      actor: this.id,
      action: "agent.started",
      target: context.task.id,
      workflowId,
      taskId: context.task.id,
      riskLevel: context.task.riskLevel,
      details: {
        role: this.config.role,
        modelClass: this.modelClassFor(context),
      },
    });

    const modelClass = this.modelClassFor(context);
    const response = await this.modelRouter.generate({
      modelClass,
      systemPrompt: this.config.systemPrompt,
      userPrompt: this.buildPrompt(context),
      temperature: this.temperature(),
      agentId: this.id,
      taskId: context.task.id,
      workflowId,
    });

    const parsed = this.parseModelOutput(response.text);
    const result = parsed
      ? this.buildResult(parsed, context, workflowId, modelClass)
      : this.buildBlockedResult(context, workflowId, modelClass, response.text);

    await this.auditLogger.write({
      actor: this.id,
      action: "agent.completed",
      target: context.task.id,
      workflowId,
      taskId: context.task.id,
      riskLevel: context.task.riskLevel,
      details: {
        status: result.status,
        artifacts: result.artifacts.length,
        approvalRequired: result.approvalRequired,
        parsed: parsed !== null,
      },
    });

    return result;
  }

  /** Builds the role-scoped, structured prompt with an explicit output schema. */
  protected buildPrompt(context: ScopedContext): string {
    const lines: string[] = [
      `Agent: ${this.config.displayName}`,
      `Role: ${this.config.role}`,
      `Mission: ${this.config.mission}`,
      "",
      `Task: ${context.task.title}`,
      `Description: ${context.task.description}`,
      `Risk Level: ${context.task.riskLevel}`,
      `Context snapshot: ${context.snapshotAt}`,
      `Context sources: ${context.contextSourceIds.join(", ") || "none"}`,
      "",
      "Constraints:",
      ...context.constraints.map((c) => `- ${c}`),
      "",
      "Architecture Docs:",
      ...context.architectureDocs.map((d) => `- ${d}`),
      "",
      "SOPs:",
      ...context.standardOperatingProcedures.map((s) => `- ${s}`),
      "",
      "Prior Decisions:",
      ...context.priorDecisions.map((d) => `- ${d}`),
      "",
      "Open Issues:",
      ...context.openIssues.map((i) => `- ${i}`),
      "",
      "Prior Artifacts (claims only):",
      ...context.priorArtifacts.flatMap((a) => [
        `- [${a.author}] ${a.title}`,
        ...a.claims.map((c) => `    • ${c}`),
      ]),
      "",
      "Unresolved unknowns:",
      ...context.unresolvedUnknowns.map((u) => `- ${u}`),
      "",
      "Evaluation Criteria:",
      ...this.config.evaluationCriteria.map((c) => `- ${c}`),
      "",
      "Respond ONLY with a JSON object (no prose, no markdown fences) with keys:",
      this.outputSchema(),
    ];
    return lines.join("\n");
  }

  protected outputSchema(): string {
    const base =
      '{ "summary": string, "findings": string[], "risks": string[], ' +
      '"recommendations": string[], "unknowns": string[], "nextSafeStep": string, ' +
      '"assumptions": string[]';
    if (this.id === "ra") {
      return (
        base +
        ', "filesAffected": string[], "testPlan": string[], ' +
        '"rollbackPlan": string[], "validationCommands": string[] }'
      );
    }
    return base + " }";
  }

  /** Defensive JSON parse. Returns null on any malformed output. */
  protected parseModelOutput(text: string): ModelOutput | null {
    const cleaned = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Extract the outermost JSON object if the model added stray text.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);

    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      return {
        summary: this.str(obj.summary),
        findings: this.strArray(obj.findings),
        risks: this.strArray(obj.risks),
        recommendations: this.strArray(obj.recommendations),
        unknowns: this.strArray(obj.unknowns),
        nextSafeStep: this.str(obj.nextSafeStep),
        assumptions: this.strArray(obj.assumptions),
        filesAffected: obj.filesAffected
          ? this.strArray(obj.filesAffected)
          : undefined,
        testPlan: obj.testPlan ? this.strArray(obj.testPlan) : undefined,
        rollbackPlan: obj.rollbackPlan
          ? this.strArray(obj.rollbackPlan)
          : undefined,
        validationCommands: obj.validationCommands
          ? this.strArray(obj.validationCommands)
          : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Each agent decides approval requirement and final result assembly. */
  protected abstract buildResult(
    output: ModelOutput,
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
  ): AgentResult;

  /** Safe fallback when the model returns unusable output. */
  protected buildBlockedResult(
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
    rawText: string,
  ): AgentResult {
    const artifact = this.makeArtifact(
      {
        title: `${this.config.displayName} — unpar-seable model output`,
        content:
          "Model output could not be parsed into the required schema.\n\n" +
          "Raw (truncated):\n" +
          rawText.slice(0, 500),
      },
      context,
      workflowId,
      modelClass,
    );

    return {
      agentId: this.id,
      status: "blocked",
      summary: `${this.config.displayName} could not parse model output; blocking rather than guessing.`,
      findings: [],
      risks: ["Model returned malformed output; no findings can be trusted."],
      recommendations: ["Retry with a stricter prompt or a different model."],
      artifacts: [artifact],
      approvalRequired: true,
      unknowns: ["All — model output was unusable."],
      nextSafeStep: "Re-run this agent; if it persists, escalate to a human.",
      assumptions: [],
    };
  }

  protected makeArtifact(
    input: { title: string; content: string; type?: ArtifactType },
    context: ScopedContext,
    workflowId: string,
    modelClass: ModelClass,
  ): Artifact {
    return {
      id: randomUUID(),
      type: input.type ?? this.artifactType(),
      title: input.title,
      content: input.content,
      author: this.id,
      timestamp: new Date().toISOString(),
      taskId: context.task.id,
      workflowId,
      contextSourceIds: context.contextSourceIds,
      modelRoute: modelClass,
    };
  }

  private str(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private strArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((v): v is string => typeof v === "string");
  }
}
