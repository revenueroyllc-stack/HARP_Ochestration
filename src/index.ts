/**
 * H.A.R.P.™ — Composition root.
 *
 * Wires the dependency graph and runs a demonstration workflow. This is the
 * only place concrete implementations are chosen; everything else depends on
 * interfaces, so swapping the stub model for a real provider, or the in-memory
 * stores for Postgres, touches only this file.
 */

import { randomUUID } from "node:crypto";

import { AgentRegistry } from "./agents/AgentRegistry.js";
import { ModelRouter } from "./models/ModelRouter.js";
import { buildModelProvider } from "./modelProvider.js";
import { InMemoryAuditLogger } from "./storage/AuditLogger.js";
import { InMemoryArtifactStore } from "./storage/MemoryStore.js";
import { InMemoryKnowledgeStore } from "./knowledge/KnowledgeStore.js";
import { PermissionGuard } from "./security/PermissionGuard.js";
import { ApprovalGate, ConsoleApprovalProvider } from "./security/ApprovalGate.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";
import { createDefaultTools } from "./tools/defaultTools.js";
import { HarpOrchestrator } from "./orchestration/HarpOrchestrator.js";
import { InMemoryObservability } from "./observability/InMemoryObservability.js";
import { ProgressiveContextLoader } from "./context/ProgressiveContextLoader.js";
import { ResourceAwareRouter } from "./models/ResourceAwareRouter.js";
import { BudgetManager } from "./models/BudgetManager.js";
import { StrategyActivationPolicy } from "./orchestration/strategies/advanced/ActivationPolicy.js";
import { buildAdvancedStrategies } from "./orchestration/strategies/advanced/advancedStrategies.js";
import type { ProjectContext } from "./core/types.js";

export interface HarpSystem {
  orchestrator: HarpOrchestrator;
  auditLogger: InMemoryAuditLogger;
  memoryStore: InMemoryArtifactStore;
  knowledgeStore: InMemoryKnowledgeStore;
  toolRegistry: ToolRegistry;
  modelRouter: ModelRouter;
  observability: InMemoryObservability;
  contextLoader: ProgressiveContextLoader;
  resourceRouter: ResourceAwareRouter;
  budgetManager: BudgetManager;
  activationPolicy: StrategyActivationPolicy;
  advancedStrategies: ReturnType<typeof buildAdvancedStrategies>;
}

/** Builds a fully-wired H.A.R.P. system from injected or default parts. */
export async function createHarpSystem(
  projectContext: ProjectContext,
): Promise<HarpSystem> {
  const observability = new InMemoryObservability();
  const modelRouter = new ModelRouter(await buildModelProvider());
  const auditLogger = new InMemoryAuditLogger();
  const memoryStore = new InMemoryArtifactStore();
  const knowledgeStore = new InMemoryKnowledgeStore();
  await knowledgeStore.load(projectContext);

  const permissionGuard = new PermissionGuard();
  const approvalGate = new ApprovalGate(new ConsoleApprovalProvider());

  const toolRegistry = new ToolRegistry(permissionGuard, auditLogger);
  for (const tool of createDefaultTools(knowledgeStore)) {
    toolRegistry.register(tool);
  }

  // Control surfaces (real now): progressive context, resource routing,
  // budget hardening, and the gated advanced-strategy policy.
  const contextLoader = new ProgressiveContextLoader(observability);
  const resourceRouter = new ResourceAwareRouter({ obs: observability });
  const budgetManager = new BudgetManager({
    workflow: { soft: 150_000, hard: 200_000 },
    obs: observability,
  });
  const activationPolicy = new StrategyActivationPolicy(auditLogger);
  const advancedStrategies = buildAdvancedStrategies(activationPolicy);

  const agents = new AgentRegistry({ modelRouter, auditLogger });
  const orchestrator = new HarpOrchestrator(
    agents,
    memoryStore,
    auditLogger,
    approvalGate,
  );

  return {
    orchestrator,
    auditLogger,
    memoryStore,
    knowledgeStore,
    toolRegistry,
    modelRouter,
    observability,
    contextLoader,
    resourceRouter,
    budgetManager,
    activationPolicy,
    advancedStrategies,
  };
}

const DEMO_PROJECT_CONTEXT: ProjectContext = {
  architectureDocs: [
    "H.A.R.P. uses Pharaoh, Horus Nexus, Anubis Sentinel, and Ra.",
    "Agents share knowledge through memory and audit services.",
    "State-changing operations require approval.",
  ],
  standardOperatingProcedures: [
    "Architecture review must happen before implementation.",
    "Security and risk validation must happen before code is applied.",
    "Generated implementation is a proposal until approved.",
  ],
  glossary: {
    HARP: "Hierarchical Agentic Review & Production System",
    Pharaoh: "Executive Orchestrator + Knowledge Librarian",
    "Horus Nexus": "Observation / Review / Long-term Planning",
    "Anubis Sentinel": "Validation / Risk / Security Monitoring",
    Ra: "Generation / Creation / Scheduling / Automation",
  },
  priorDecisions: [
    "Use core four agents only.",
    "Use approval gates for repo writes and automation.",
  ],
  openIssues: [
    "Replace stub model provider with real provider.",
    "Persist audit logs to database.",
  ],
  workflowHistory: [],
};

async function runDemo(): Promise<void> {
  const system = await createHarpSystem(DEMO_PROJECT_CONTEXT);

  const result = await system.orchestrator.execute({
    task: {
      id: randomUUID(),
      title: "Improve H.A.R.P. core architecture",
      description:
        "Refactor H.A.R.P. into a maintainable, scalable, production-grade core-four orchestration system.",
      requestedBy: "Revenue",
      repo: "H.A.R.P.",
      riskLevel: "high",
      requiresRepoWrite: true,
      reversible: true,
      createdAt: new Date().toISOString(),
    },
    projectContext: DEMO_PROJECT_CONTEXT,
  });

  console.log("=== Workflow Result ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("\n=== Audit Events ===");
  console.log(JSON.stringify(await system.auditLogger.list(), null, 2));
  console.log("\n=== Model Call Records ===");
  console.log(JSON.stringify(system.modelRouter.callRecords(), null, 2));
}

// Only run the demo when executed directly, not when imported.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runDemo().catch((error) => {
    console.error("H.A.R.P. runtime failure:", error);
    process.exitCode = 1;
  });
}
