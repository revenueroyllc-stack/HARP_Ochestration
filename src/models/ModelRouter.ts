/**
 * H.A.R.P.™ — Model router (AIOS §13).
 *
 * Agents never call a provider directly. The router selects the provider,
 * tracks cost/latency per call, and enforces a per-workflow token budget.
 * When the budget is exhausted the router signals exhaustion so Pharaoh can
 * stop or downshift rather than silently overspending.
 */

import { DEFAULT_WORKFLOW_TOKEN_BUDGET } from "../core/constants.js";
import type {
  ModelClass,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../core/types.js";

export interface ModelCallRecord {
  agentId?: string;
  taskId?: string;
  workflowId?: string;
  modelUsed: string;
  modelClass: ModelClass;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  timestamp: string;
}

export class TokenBudgetExceededError extends Error {
  constructor(
    readonly workflowId: string,
    readonly used: number,
    readonly budget: number,
  ) {
    super(
      `Token budget exceeded for workflow ${workflowId}: used ${used} of ${budget}.`,
    );
    this.name = "TokenBudgetExceededError";
  }
}

export interface ModelRouterOptions {
  /** Per-workflow token budget. Defaults to DEFAULT_WORKFLOW_TOKEN_BUDGET. */
  workflowTokenBudget?: number;
}

export class ModelRouter {
  private readonly records: ModelCallRecord[] = [];
  private readonly usageByWorkflow = new Map<string, number>();
  private readonly budget: number;

  constructor(
    private readonly provider: ModelProvider,
    options: ModelRouterOptions = {},
  ) {
    this.budget = options.workflowTokenBudget ?? DEFAULT_WORKFLOW_TOKEN_BUDGET;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const workflowId = request.workflowId ?? "unscoped";
    const usedSoFar = this.usageByWorkflow.get(workflowId) ?? 0;

    if (usedSoFar >= this.budget) {
      throw new TokenBudgetExceededError(workflowId, usedSoFar, this.budget);
    }

    const response = await this.provider.generate(request);

    const totalTokens = response.inputTokens + response.outputTokens;
    this.usageByWorkflow.set(workflowId, usedSoFar + totalTokens);

    this.records.push({
      agentId: request.agentId,
      taskId: request.taskId,
      workflowId: request.workflowId,
      modelUsed: response.modelUsed,
      modelClass: response.modelClass,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      estimatedCostUsd: response.estimatedCostUsd,
      latencyMs: response.latencyMs,
      timestamp: new Date().toISOString(),
    });

    return response;
  }

  /** Total tokens consumed by a workflow so far. */
  usage(workflowId: string): number {
    return this.usageByWorkflow.get(workflowId) ?? 0;
  }

  remainingBudget(workflowId: string): number {
    return Math.max(0, this.budget - this.usage(workflowId));
  }

  callRecords(): ModelCallRecord[] {
    return [...this.records];
  }
}
