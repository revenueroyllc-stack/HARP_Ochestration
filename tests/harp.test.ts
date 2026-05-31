/**
 * H.A.R.P.™ — Test suite (AIOS §24 minimum coverage).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AgentRegistry } from "../src/agents/AgentRegistry.js";
import { ModelRouter } from "../src/models/ModelRouter.js";
import { StubModelProvider } from "../src/models/providers/StubModelProvider.js";
import { InMemoryAuditLogger } from "../src/storage/AuditLogger.js";
import { InMemoryArtifactStore } from "../src/storage/MemoryStore.js";
import { PermissionGuard, PermissionDeniedError } from "../src/security/PermissionGuard.js";
import {
  ApprovalGate,
  ConsoleApprovalProvider,
  AutoApproveProvider,
} from "../src/security/ApprovalGate.js";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";
import { createDefaultTools } from "../src/tools/defaultTools.js";
import { InMemoryKnowledgeStore } from "../src/knowledge/KnowledgeStore.js";
import { ContextManager } from "../src/orchestration/ContextManager.js";
import { StrategySelector } from "../src/orchestration/StrategySelector.js";
import { HarpOrchestrator } from "../src/orchestration/HarpOrchestrator.js";
import type { AgentTask, ProjectContext } from "../src/core/types.js";

const PROJECT_CONTEXT: ProjectContext = {
  architectureDocs: ["Core four architecture.", "Approval gates required."],
  standardOperatingProcedures: [
    "Architecture review before implementation.",
    "Security validation before code is applied.",
  ],
  glossary: { HARP: "Hierarchical Agentic Review & Production System" },
  priorDecisions: ["Use core four agents only."],
  openIssues: ["Replace stub provider."],
  workflowHistory: [],
};

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: randomUUID(),
    title: "Test task",
    description: "A test task.",
    requestedBy: "tester",
    riskLevel: "high",
    requiresRepoWrite: true,
    reversible: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildSystem(opts: { autoApprove?: boolean } = {}) {
  const modelRouter = new ModelRouter(new StubModelProvider());
  const auditLogger = new InMemoryAuditLogger();
  const memoryStore = new InMemoryArtifactStore();
  const approvalGate = new ApprovalGate(
    opts.autoApprove ? new AutoApproveProvider() : new ConsoleApprovalProvider(),
  );
  const agents = new AgentRegistry({ modelRouter, auditLogger });
  const orchestrator = new HarpOrchestrator(
    agents,
    memoryStore,
    auditLogger,
    approvalGate,
  );
  return { modelRouter, auditLogger, memoryStore, agents, orchestrator };
}

describe("AgentRegistry", () => {
  it("creates all four agents", () => {
    const { agents } = buildSystem();
    expect(agents.get("pharaoh").id).toBe("pharaoh");
    expect(agents.get("horus-nexus").id).toBe("horus-nexus");
    expect(agents.get("anubis-sentinel").id).toBe("anubis-sentinel");
    expect(agents.get("ra").id).toBe("ra");
    expect(agents.all()).toHaveLength(4);
  });
});

describe("PermissionGuard", () => {
  it("blocks unauthorized access", () => {
    const guard = new PermissionGuard();
    // Horus Nexus has no repo:write.
    expect(guard.can("horus-nexus", "repo:write")).toBe(false);
    expect(() => guard.assert("horus-nexus", "repo:write")).toThrow(
      PermissionDeniedError,
    );
    // Ra does.
    expect(guard.can("ra", "repo:write")).toBe(true);
  });
});

describe("ToolRegistry", () => {
  it("denies tools the agent lacks permission for", async () => {
    const guard = new PermissionGuard();
    const audit = new InMemoryAuditLogger();
    const knowledge = new InMemoryKnowledgeStore();
    await knowledge.load(PROJECT_CONTEXT);
    const registry = new ToolRegistry(guard, audit);
    for (const t of createDefaultTools(knowledge)) registry.register(t);

    // Horus tries repo.write — denied.
    const t = task();
    const result = await registry.invoke(
      "repo.write",
      { path: "a.ts", contents: "x" },
      { agentId: "horus-nexus", task: t, workflowId: "w", approvalGranted: true },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission denied/i);
  });

  it("blocks state-changing tools without approval", async () => {
    const guard = new PermissionGuard();
    const audit = new InMemoryAuditLogger();
    const knowledge = new InMemoryKnowledgeStore();
    await knowledge.load(PROJECT_CONTEXT);
    const registry = new ToolRegistry(guard, audit);
    for (const t of createDefaultTools(knowledge)) registry.register(t);

    const t = task();
    const result = await registry.invoke(
      "repo.write",
      { path: "a.ts", contents: "x" },
      { agentId: "ra", task: t, workflowId: "w", approvalGranted: false },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/approval required/i);
  });

  it("allows approved state-changing tools for permitted agents", async () => {
    const guard = new PermissionGuard();
    const audit = new InMemoryAuditLogger();
    const knowledge = new InMemoryKnowledgeStore();
    await knowledge.load(PROJECT_CONTEXT);
    const registry = new ToolRegistry(guard, audit);
    for (const t of createDefaultTools(knowledge)) registry.register(t);

    const t = task();
    const result = await registry.invoke(
      "repo.write",
      { path: "a.ts", contents: "x" },
      { agentId: "ra", task: t, workflowId: "w", approvalGranted: true },
    );
    expect(result.ok).toBe(true);
  });
});

describe("ApprovalGate", () => {
  it("blocks high-risk repo writes", () => {
    const gate = new ApprovalGate(new ConsoleApprovalProvider());
    expect(gate.requiresApproval(task({ riskLevel: "high" }), "repo.write")).toBe(
      true,
    );
  });

  it("does not require approval for low-risk read actions", () => {
    const gate = new ApprovalGate(new ConsoleApprovalProvider());
    const t = task({
      riskLevel: "low",
      requiresRepoWrite: false,
      touchesSecrets: false,
    });
    expect(gate.requiresApproval(t, "repo.read")).toBe(false);
  });
});

describe("ContextManager", () => {
  it("scopes context by agent", () => {
    const cm = new ContextManager();
    const t = task();
    const raCtx = cm.createScopedContext({
      agentId: "ra",
      task: t,
      projectContext: PROJECT_CONTEXT,
      priorArtifacts: [],
    });
    // Ra receives the narrowest context: no architecture docs.
    expect(raCtx.architectureDocs).toHaveLength(0);

    const pharaohCtx = cm.createScopedContext({
      agentId: "pharaoh",
      task: t,
      projectContext: PROJECT_CONTEXT,
      priorArtifacts: [],
    });
    expect(pharaohCtx.architectureDocs.length).toBeGreaterThan(0);
  });
});

describe("StrategySelector", () => {
  it("selects sequential-review for high-risk reversible work", () => {
    const selector = new StrategySelector();
    const { chosen } = selector.select(
      task({ riskLevel: "high", reversible: true, touchesSecrets: false }),
    );
    expect(chosen.name).toBe("sequential-review");
  });

  it("forces escalation for critical or secret-touching work", () => {
    const selector = new StrategySelector();
    expect(selector.select(task({ riskLevel: "critical" })).chosen.name).toBe(
      "escalation",
    );
    expect(
      selector.select(task({ touchesSecrets: true })).chosen.name,
    ).toBe("escalation");
    expect(
      selector.select(task({ reversible: false })).chosen.name,
    ).toBe("escalation");
  });

  it("produces a full scored ranking", () => {
    const selector = new StrategySelector();
    const { ranking } = selector.select(task({ riskLevel: "medium" }));
    expect(ranking).toHaveLength(6);
    expect(ranking[0]!.composite).toBeGreaterThanOrEqual(
      ranking[5]!.composite,
    );
  });
});

describe("HarpOrchestrator", () => {
  it("runs the sequential-review sequence and records start + completion", async () => {
    const { orchestrator, auditLogger } = buildSystem({ autoApprove: true });
    const result = await orchestrator.execute({
      task: task({ riskLevel: "high", reversible: true }),
      projectContext: PROJECT_CONTEXT,
    });

    const events = await auditLogger.list();
    expect(events.some((e) => e.action === "workflow.started")).toBe(true);
    expect(events.some((e) => e.action === "workflow.completed")).toBe(true);
    expect(result.strategy).toBe("sequential-review");
    expect(result.agentResults.map((r) => r.agentId)).toEqual([
      "pharaoh",
      "horus-nexus",
      "anubis-sentinel",
      "ra",
      "horus-nexus",
      "anubis-sentinel",
      "pharaoh",
    ]);
  });

  it("blocks Ra output without approval (approval_required)", async () => {
    const { orchestrator } = buildSystem({ autoApprove: false });
    const result = await orchestrator.execute({
      task: task({ riskLevel: "high", reversible: true }),
      projectContext: PROJECT_CONTEXT,
    });
    expect(result.status).toBe("approval_required");
    expect(result.approvalRequired).toBe(true);
    // Completed artifacts before the gate are preserved.
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(
      result.artifacts.some((a) => a.type === "approval_request"),
    ).toBe(true);
  });

  it("Anubis Sentinel flags security-sensitive actions as risky", async () => {
    const { orchestrator } = buildSystem({ autoApprove: true });
    const result = await orchestrator.execute({
      task: task({ riskLevel: "high", touchesSecrets: true }),
      projectContext: PROJECT_CONTEXT,
    });
    const anubis = result.agentResults.find(
      (r) => r.agentId === "anubis-sentinel",
    );
    expect(anubis).toBeDefined();
    expect(anubis!.approvalRequired).toBe(true);
    expect(anubis!.risks.length).toBeGreaterThan(0);
  });

  it("Pharaoh produces a final recommendation", async () => {
    const { orchestrator } = buildSystem({ autoApprove: true });
    const result = await orchestrator.execute({
      task: task({ riskLevel: "high", reversible: true }),
      projectContext: PROJECT_CONTEXT,
    });
    expect(result.finalRecommendation).toBeTruthy();
    expect(
      result.artifacts.some((a) => a.type === "final_report"),
    ).toBe(true);
  });

  it("returns a failed result with preserved artifacts when the budget is exhausted", async () => {
    const modelRouter = new ModelRouter(new StubModelProvider(), {
      workflowTokenBudget: 1, // exhausts after the first call
    });
    const auditLogger = new InMemoryAuditLogger();
    const memoryStore = new InMemoryArtifactStore();
    const approvalGate = new ApprovalGate(new AutoApproveProvider());
    const agents = new AgentRegistry({ modelRouter, auditLogger });
    const orchestrator = new HarpOrchestrator(
      agents,
      memoryStore,
      auditLogger,
      approvalGate,
    );

    const result = await orchestrator.execute({
      task: task({ riskLevel: "high" }),
      projectContext: PROJECT_CONTEXT,
    });

    expect(result.status).toBe("failed");
    expect(result.failure).toBeDefined();
    expect(result.failure!.phase).toBe("model-routing");
  });
});
