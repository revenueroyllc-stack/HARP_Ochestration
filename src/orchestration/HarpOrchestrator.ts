/**
 * H.A.R.P.™ — Orchestrator.
 *
 * Owns no fixed sequence. It asks the StrategySelector which CoordinationStrategy
 * to run, executes the returned agent sequence, applies the ApprovalGate before
 * any state-changing (Ra) phase, persists every artifact, and returns a
 * structured result. Failures are captured, audited, and returned as a failed
 * workflow with all completed artifacts preserved (AIOS §23).
 */

import { randomUUID } from "node:crypto";
import type { AgentRegistry } from "../agents/AgentRegistry.js";
import type { ApprovalGate } from "../security/ApprovalGate.js";
import type { AuditLogger } from "../storage/AuditLogger.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import { TokenBudgetExceededError } from "../models/ModelRouter.js";
import { ContextManager } from "./ContextManager.js";
import { StrategySelector } from "./StrategySelector.js";
import type { CoordinationStrategy, WorkflowState } from "./strategies/CoordinationStrategy.js";
import type {
  AgentId,
  AgentResult,
  AgentTask,
  Artifact,
  ProjectContext,
  WorkflowResult,
  WorkflowStatus,
} from "../core/types.js";

export class HarpOrchestrator {
  private readonly contextManager = new ContextManager();
  private readonly strategySelector = new StrategySelector();

  constructor(
    private readonly agents: AgentRegistry,
    private readonly memoryStore: MemoryStore,
    private readonly auditLogger: AuditLogger,
    private readonly approvalGate: ApprovalGate,
  ) {}

  async execute(input: {
    task: AgentTask;
    projectContext: ProjectContext;
    /** Optionally force a strategy; otherwise it is selected by score. */
    forceStrategy?: CoordinationStrategy;
  }): Promise<WorkflowResult> {
    const startedAt = new Date().toISOString();
    const workflowId = randomUUID();
    const artifacts: Artifact[] = [];
    const agentResults: AgentResult[] = [];

    // --- Strategy selection -------------------------------------------------
    const selection = this.strategySelector.select(input.task);
    const strategy = input.forceStrategy ?? selection.chosen;
    const sequence = strategy.selectSequence({ task: input.task });

    await this.auditLogger.write({
      actor: "system",
      action: "workflow.started",
      target: input.task.id,
      workflowId,
      taskId: input.task.id,
      riskLevel: input.task.riskLevel,
      details: {
        title: input.task.title,
        repo: input.task.repo,
        strategy: strategy.name,
        rationale: selection.rationale,
        sequence,
      },
    });

    try {
      const state: WorkflowState = {
        task: input.task,
        completedAgents: [],
        results: agentResults,
        blockedForApproval: false,
      };

      for (const agentId of sequence) {
        const context = this.contextManager.createScopedContext({
          agentId,
          task: input.task,
          projectContext: input.projectContext,
          priorArtifacts: artifacts,
        });

        const result = await this.agents.get(agentId).execute({
          task: { id: input.task.id },
          context,
          workflowId,
        });

        agentResults.push(result);
        artifacts.push(...result.artifacts);
        for (const artifact of result.artifacts) {
          await this.memoryStore.append(artifact);
        }
        state.completedAgents.push(agentId);

        // Approval gate before state-changing (Ra) work proceeds.
        if (agentId === "ra") {
          const blocked = await this.enforceApproval({
            task: input.task,
            workflowId,
            result,
            artifacts,
            agentResults,
            startedAt,
            strategyName: strategy.name,
          });
          if (blocked) {
            state.blockedForApproval = true;
            return blocked;
          }
        }

        // Strategy-defined early stop.
        if (strategy.shouldStop?.(state)) {
          break;
        }
      }

      await this.auditLogger.write({
        actor: "system",
        action: "workflow.completed",
        target: input.task.id,
        workflowId,
        taskId: input.task.id,
        riskLevel: input.task.riskLevel,
        details: {
          artifactCount: artifacts.length,
          agentRuns: agentResults.map((r) => r.agentId),
          strategy: strategy.name,
        },
      });

      const approvalRequired = agentResults.some((r) => r.approvalRequired);
      return this.result({
        workflowId,
        task: input.task,
        status: "completed",
        strategyName: strategy.name,
        artifacts,
        agentResults,
        approvalRequired,
        finalRecommendation:
          "H.A.R.P. completed the review-build-validation loop. Apply changes only after final human approval and CI validation.",
        startedAt,
      });
    } catch (error) {
      return this.handleFailure({
        error,
        workflowId,
        task: input.task,
        strategyName: strategy.name,
        artifacts,
        agentResults,
        completedAgents: agentResults.map((r) => r.agentId),
        startedAt,
      });
    }
  }

  /** Applies the approval gate; returns a blocking WorkflowResult or null. */
  private async enforceApproval(input: {
    task: AgentTask;
    workflowId: string;
    result: AgentResult;
    artifacts: Artifact[];
    agentResults: AgentResult[];
    startedAt: string;
    strategyName: WorkflowResult["strategy"];
  }): Promise<WorkflowResult | null> {
    const decision = await this.approvalGate.evaluate({
      task: input.task,
      workflowId: input.workflowId,
      phase: "production",
      action: "repo.write",
      details: input.result.summary,
      artifactIds: input.result.artifacts.map((a) => a.id),
    });

    if (!decision.required || decision.approved) {
      await this.auditLogger.write({
        actor: "system",
        action: "workflow.approval_evaluated",
        target: input.task.id,
        workflowId: input.workflowId,
        taskId: input.task.id,
        riskLevel: input.task.riskLevel,
        approvalState: decision.required ? "granted" : "not_required",
        details: { reason: decision.reason, approverId: decision.approverId },
      });
      return null;
    }

    // Blocked pending human approval.
    const approvalArtifact: Artifact = {
      id: randomUUID(),
      type: "approval_request",
      title: "Human Approval Required",
      content: decision.reason,
      author: "pharaoh",
      timestamp: new Date().toISOString(),
      taskId: input.task.id,
      workflowId: input.workflowId,
      contextSourceIds: [],
      metadata: { blockedAgent: "ra" },
    };
    input.artifacts.push(approvalArtifact);
    await this.memoryStore.append(approvalArtifact);

    await this.auditLogger.write({
      actor: "system",
      action: "workflow.approval_required",
      target: input.task.id,
      workflowId: input.workflowId,
      taskId: input.task.id,
      riskLevel: input.task.riskLevel,
      approvalState: "denied",
      details: { reason: decision.reason },
    });

    return this.result({
      workflowId: input.workflowId,
      task: input.task,
      status: "approval_required",
      strategyName: input.strategyName,
      artifacts: input.artifacts,
      agentResults: input.agentResults,
      approvalRequired: true,
      finalRecommendation:
        "H.A.R.P. generated implementation output, but production execution is blocked pending human approval.",
      startedAt: input.startedAt,
    });
  }

  private async handleFailure(input: {
    error: unknown;
    workflowId: string;
    task: AgentTask;
    strategyName: WorkflowResult["strategy"];
    artifacts: Artifact[];
    agentResults: AgentResult[];
    completedAgents: AgentId[];
    startedAt: string;
  }): Promise<WorkflowResult> {
    const reason =
      input.error instanceof Error
        ? input.error.message
        : String(input.error);

    const isBudget = input.error instanceof TokenBudgetExceededError;
    const failedActor =
      input.completedAgents[input.completedAgents.length - 1] ?? "system";

    const audit = await this.auditLogger.write({
      actor: "system",
      action: "workflow.failed",
      target: input.task.id,
      workflowId: input.workflowId,
      taskId: input.task.id,
      riskLevel: input.task.riskLevel,
      details: { reason, budgetExceeded: isBudget },
    });

    return this.result({
      workflowId: input.workflowId,
      task: input.task,
      status: "failed",
      strategyName: input.strategyName,
      artifacts: input.artifacts,
      agentResults: input.agentResults,
      approvalRequired: true,
      finalRecommendation: isBudget
        ? "Token budget exhausted. Downshift model class or raise the budget, then resume."
        : "H.A.R.P. workflow failed. Review audit logs before retrying.",
      startedAt: input.startedAt,
      failure: {
        phase: isBudget ? "model-routing" : "agent-execution",
        failedActor,
        reason,
        auditEventId: audit.id,
        recoveryRecommendation: isBudget
          ? "Lower model tier or increase DEFAULT_WORKFLOW_TOKEN_BUDGET."
          : "Inspect the failed agent's audit trail; fix root cause; re-run.",
      },
    });
  }

  private result(input: {
    workflowId: string;
    task: AgentTask;
    status: WorkflowStatus;
    strategyName: WorkflowResult["strategy"];
    artifacts: Artifact[];
    agentResults: AgentResult[];
    approvalRequired: boolean;
    finalRecommendation: string;
    startedAt: string;
    failure?: WorkflowResult["failure"];
  }): WorkflowResult {
    return {
      id: input.workflowId,
      task: input.task,
      status: input.status,
      strategy: input.strategyName,
      artifacts: input.artifacts,
      agentResults: input.agentResults,
      approvalRequired: input.approvalRequired,
      finalRecommendation: input.finalRecommendation,
      failure: input.failure,
      startedAt: input.startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
