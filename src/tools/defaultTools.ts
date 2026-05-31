/**
 * H.A.R.P.™ — Default tools.
 *
 * A minimal, safe tool set. Read tools are non-state-changing; the repo write
 * and schedule tools are state-changing and therefore approval-gated by the
 * ToolRegistry. The implementations are stubs — real deployments back these
 * with sandboxed repo access, a scheduler, etc.
 */

import type { KnowledgeStore } from "../knowledge/KnowledgeStore.js";
import type { ToolDefinition } from "../core/types.js";

export function createDefaultTools(
  knowledgeStore: KnowledgeStore,
): ToolDefinition[] {
  const knowledgeSearch: ToolDefinition<{ query: string }, unknown> = {
    name: "knowledge.search",
    description: "Search project knowledge for relevant grounding material.",
    requiredPermission: "knowledge:read",
    stateChanging: false,
    async run(input) {
      return knowledgeStore.search(input.query, 8);
    },
  };

  const repoRead: ToolDefinition<{ path: string }, unknown> = {
    name: "repo.read",
    description: "Read a file from the project repository (sandboxed).",
    requiredPermission: "repo:read",
    stateChanging: false,
    async run(input) {
      return {
        path: input.path,
        note: "Stub repo read — connect a sandboxed repository reader.",
      };
    },
  };

  const repoWrite: ToolDefinition<
    { path: string; contents: string },
    unknown
  > = {
    name: "repo.write",
    description: "Propose a write to the repository. APPROVAL-GATED.",
    requiredPermission: "repo:write",
    stateChanging: true,
    async run(input) {
      return {
        path: input.path,
        bytes: input.contents.length,
        note: "Stub repo write — in production this opens a PR, never a direct commit.",
      };
    },
  };

  const scheduleCreate: ToolDefinition<{ cron: string }, unknown> = {
    name: "schedule.create",
    description: "Create a scheduled automation. APPROVAL-GATED.",
    requiredPermission: "schedule:create",
    stateChanging: true,
    async run(input) {
      return {
        cron: input.cron,
        note: "Stub scheduler — requires explicit authorization in production.",
      };
    },
  };

  const securityScan: ToolDefinition<{ target: string }, unknown> = {
    name: "security.scan",
    description: "Run a security scan over a target path or artifact.",
    requiredPermission: "security:scan",
    stateChanging: false,
    async run(input) {
      return {
        target: input.target,
        findings: [],
        note: "Stub security scan — connect a real SAST/secret scanner.",
      };
    },
  };

  return [knowledgeSearch, repoRead, repoWrite, scheduleCreate, securityScan];
}
