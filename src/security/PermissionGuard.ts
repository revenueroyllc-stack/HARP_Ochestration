/**
 * H.A.R.P.™ — Permission guard (least privilege).
 *
 * Enforces the per-agent permission map at runtime. Previously this existed
 * but was never invoked; the ToolRegistry and agents now call `assert` before
 * any permissioned action, so the guard is load-bearing rather than
 * decorative.
 */

import { AGENT_CONFIGS } from "../core/agentConfig.js";
import type { AgentId, Permission } from "../core/types.js";

export class PermissionDeniedError extends Error {
  constructor(
    readonly agentId: AgentId,
    readonly permission: Permission,
  ) {
    super(`Agent ${agentId} does not have permission: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export class PermissionGuard {
  /** Throws PermissionDeniedError if the agent lacks the permission. */
  assert(agentId: AgentId, permission: Permission): void {
    if (!this.can(agentId, permission)) {
      throw new PermissionDeniedError(agentId, permission);
    }
  }

  can(agentId: AgentId, permission: Permission): boolean {
    return AGENT_CONFIGS[agentId].permissions.includes(permission);
  }

  permissionsFor(agentId: AgentId): readonly Permission[] {
    return AGENT_CONFIGS[agentId].permissions;
  }
}
