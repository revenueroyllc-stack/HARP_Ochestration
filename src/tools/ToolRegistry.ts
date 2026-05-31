/**
 * H.A.R.P.™ — Tool registry (AIOS §16).
 *
 * Agents never call tools directly. Every invocation routes through the
 * registry, which checks (1) the agent holds the required permission and
 * (2) state-changing tools have approval. Results are always structured;
 * tools never throw raw errors into the workflow.
 */

import { randomUUID } from "node:crypto";
import type { AuditLogger } from "../storage/AuditLogger.js";
import { PermissionGuard } from "../security/PermissionGuard.js";
import type {
  AgentId,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "../core/types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly permissionGuard: PermissionGuard,
    private readonly auditLogger: AuditLogger,
  ) {}

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Tools an agent is permitted to invoke. */
  availableTo(agentId: AgentId): ToolDefinition[] {
    return this.list().filter((tool) =>
      this.permissionGuard.can(agentId, tool.requiredPermission),
    );
  }

  async invoke<I, O>(
    name: string,
    input: I,
    context: ToolContext,
  ): Promise<ToolResult<O>> {
    const tool = this.tools.get(name) as ToolDefinition<I, O> | undefined;

    if (!tool) {
      return { toolName: name, ok: false, error: `Unknown tool: ${name}` };
    }

    // (1) Permission check.
    if (!this.permissionGuard.can(context.agentId, tool.requiredPermission)) {
      const audit = await this.auditLogger.write({
        actor: context.agentId,
        action: "tool.permission_denied",
        target: name,
        workflowId: context.workflowId,
        taskId: context.task.id,
        riskLevel: context.task.riskLevel,
        details: { requiredPermission: tool.requiredPermission },
      });
      return {
        toolName: name,
        ok: false,
        error: `Permission denied: ${context.agentId} lacks ${tool.requiredPermission}`,
        auditId: audit.id,
      };
    }

    // (2) Approval check for state-changing tools.
    if (tool.stateChanging && !context.approvalGranted) {
      const audit = await this.auditLogger.write({
        actor: context.agentId,
        action: "tool.approval_required",
        target: name,
        workflowId: context.workflowId,
        taskId: context.task.id,
        riskLevel: context.task.riskLevel,
        approvalState: "required",
        details: { reason: "State-changing tool invoked without approval." },
      });
      return {
        toolName: name,
        ok: false,
        error: `Approval required before invoking state-changing tool: ${name}`,
        auditId: audit.id,
      };
    }

    // (3) Run the tool, converting any throw into a structured result.
    try {
      const output = await tool.run(input, context);
      const audit = await this.auditLogger.write({
        actor: context.agentId,
        action: "tool.invoked",
        target: name,
        workflowId: context.workflowId,
        taskId: context.task.id,
        riskLevel: context.task.riskLevel,
        details: { stateChanging: tool.stateChanging },
      });
      return { toolName: name, ok: true, output, auditId: audit.id };
    } catch (error) {
      const audit = await this.auditLogger.write({
        actor: context.agentId,
        action: "tool.failed",
        target: name,
        workflowId: context.workflowId,
        taskId: context.task.id,
        riskLevel: context.task.riskLevel,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return {
        toolName: name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        auditId: audit.id,
      };
    }
  }

  /** Generates a unique audit-friendly id for tool runs that need one. */
  static newRunId(): string {
    return randomUUID();
  }
}
