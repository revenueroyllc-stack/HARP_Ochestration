/**
 * H.A.R.P.™ — Approval gate (AIOS §8).
 *
 * Determines whether an action needs human approval and, if so, routes the
 * request to an ApprovalProvider. Console logging is explicitly NOT a valid
 * production approval mechanism; the ConsoleApprovalProvider always denies to
 * make that failure mode loud rather than silent.
 */

import {
  APPROVAL_FORCING_RISK,
  STATE_CHANGING_ACTION_MARKERS,
} from "../core/constants.js";
import type {
  AgentTask,
  ApprovalDecision,
  ApprovalProvider,
  ApprovalRequest,
} from "../core/types.js";

export { ApprovalProvider, ApprovalRequest, ApprovalDecision };

/**
 * Default provider. Returns "required but not approved" so that, absent a real
 * human approval integration, high-risk work is blocked rather than waved
 * through. Production deployments inject a dashboard / PR-review provider.
 */
export class ConsoleApprovalProvider implements ApprovalProvider {
  async requestApproval(input: ApprovalRequest): Promise<ApprovalDecision> {
    return {
      required: true,
      approved: false,
      reason:
        `Approval required for phase "${input.phase}" (action: ${input.action}). ` +
        "Console logging is not a production approval mechanism; route this to a human approval UI, PR review, or signed approval event.",
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Auto-approving provider for tests and bounded low-risk automation only.
 * Never use in production for high-risk actions.
 */
export class AutoApproveProvider implements ApprovalProvider {
  constructor(private readonly approverId = "test-harness") {}

  async requestApproval(input: ApprovalRequest): Promise<ApprovalDecision> {
    return {
      required: true,
      approved: true,
      reason: `Auto-approved for ${input.phase}.`,
      approverId: this.approverId,
      timestamp: new Date().toISOString(),
    };
  }
}

export class ApprovalGate {
  constructor(private readonly approvalProvider: ApprovalProvider) {}

  /** True if the task/action combination demands human approval. */
  requiresApproval(task: AgentTask, action: string): boolean {
    if (APPROVAL_FORCING_RISK.has(task.riskLevel)) {
      return true;
    }
    if (task.requiresRepoWrite || task.touchesSecrets) {
      return true;
    }
    const normalised = action.toLowerCase();
    return STATE_CHANGING_ACTION_MARKERS.some((marker) =>
      normalised.includes(marker),
    );
  }

  async evaluate(input: {
    task: AgentTask;
    workflowId: string;
    phase: string;
    action: string;
    details: string;
    artifactIds: string[];
  }): Promise<ApprovalDecision> {
    if (!this.requiresApproval(input.task, input.action)) {
      return {
        required: false,
        approved: true,
        reason: "Approval not required.",
        timestamp: new Date().toISOString(),
      };
    }

    return this.approvalProvider.requestApproval({
      task: input.task,
      workflowId: input.workflowId,
      phase: input.phase,
      action: input.action,
      details: input.details,
      artifactIds: input.artifactIds,
    });
  }
}
