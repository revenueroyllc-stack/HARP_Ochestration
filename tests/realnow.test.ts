/**
 * H.A.R.P.™ — Real-now layer + gated-strategy tests.
 *
 * Proves the control surfaces work and that advanced strategies stay safely
 * disabled until explicitly activated AND model-validated.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryObservability } from "../src/observability/InMemoryObservability.js";
import { ProgressiveContextLoader } from "../src/context/ProgressiveContextLoader.js";
import { ThreadCompactor } from "../src/context/ThreadCompactor.js";
import { ResourceAwareRouter } from "../src/models/ResourceAwareRouter.js";
import { BudgetManager } from "../src/models/BudgetManager.js";
import { SequentialValidator } from "../src/orchestration/SequentialValidator.js";
import { governanceSummary, GOVERNANCE_MAPPING } from "../src/governance/mapping.js";
import { StrategyActivationPolicy } from "../src/orchestration/strategies/advanced/ActivationPolicy.js";
import {
  buildAdvancedStrategies,
  ChainOfDebatesStrategy,
} from "../src/orchestration/strategies/advanced/advancedStrategies.js";
import { InMemoryAuditLogger } from "../src/storage/AuditLogger.js";
import type { AgentTask } from "../src/core/types.js";

function task(): AgentTask {
  return {
    id: "t1",
    title: "t",
    description: "d",
    requestedBy: "x",
    riskLevel: "high",
    createdAt: new Date().toISOString(),
  };
}

describe("ProgressiveContextLoader", () => {
  it("loads only selected skill bodies (just-in-time), metadata always cheap", async () => {
    const obs = new InMemoryObservability();
    const loader = new ProgressiveContextLoader(obs);
    loader.register(
      { id: "ts", name: "TypeScript", description: "TS review skill" },
      () => ({ instructions: "Very long TS instructions ".repeat(50) }),
    );
    loader.register(
      { id: "sql", name: "SQL", description: "SQL review skill" },
      () => ({ instructions: "SQL instructions ".repeat(50) }),
    );

    const ctx = await loader.load({ selectedSkillIds: ["ts"] });
    // Both metadata present (Level 1), only one body loaded (Level 2).
    expect(ctx.catalog).toHaveLength(2);
    expect(Object.keys(ctx.bodies)).toEqual(["ts"]);
    expect(ctx.tokenCost.level2).toBeGreaterThan(0);
    // Telemetry recorded.
    expect(obs.spansNamed("context.progressive_load").length).toBe(1);
  });

  it("pulls Level-3 references only when requested", async () => {
    const loader = new ProgressiveContextLoader();
    loader.register({ id: "a", name: "A", description: "d" }, () => ({
      instructions: "x",
      referenceIds: ["ref1"],
    }));
    loader.setReferenceLoader((id) => `REF:${id}`);

    const without = await loader.load({ selectedSkillIds: ["a"] });
    expect(Object.keys(without.references)).toHaveLength(0);

    const withRef = await loader.load({
      selectedSkillIds: ["a"],
      referenceIds: ["ref1"],
    });
    expect(withRef.references.ref1).toBe("REF:ref1");
  });
});

describe("ResourceAwareRouter", () => {
  it("routes cheap work to fast models and never downgrades high risk", () => {
    const r = new ResourceAwareRouter();
    expect(r.route({ kind: "extraction", risk: "low" }).modelClass).toBe(
      "cloud-fast",
    );
    const hiSynth = r.route({ kind: "synthesis", risk: "high" });
    expect(hiSynth.modelClass).toBe("frontier-reasoning");
    expect(hiSynth.upgradedForRisk).toBe(true);
    const hiSec = r.route({ kind: "security", risk: "critical" });
    expect(hiSec.modelClass).toBe("security-specialist");
  });

  it("plans fan-out: many cheap workers, one synthesis, clamped to max", () => {
    const r = new ResourceAwareRouter({ maxFanOut: 3 });
    const plan = r.planFanOut({
      workerKind: "research",
      desiredWorkers: 10,
      risk: "high",
    });
    expect(plan.workers.count).toBe(3); // clamped
    expect(plan.workers.modelClass).toBe("cloud-fast");
    expect(plan.synthesis.modelClass).toBe("frontier-reasoning");
  });
});

describe("BudgetManager", () => {
  it("returns ok, then downshift at soft, then cutoff at hard", () => {
    const b = new BudgetManager({ workflow: { soft: 100, hard: 200 } });
    expect(b.check({ tokens: 50, workflowId: "w" }).decision).toBe("ok");
    b.record({ tokens: 120, workflowId: "w" });
    expect(b.check({ tokens: 10, workflowId: "w" }).decision).toBe("downshift");
    expect(b.check({ tokens: 100, workflowId: "w" }).decision).toBe("cutoff");
  });

  it("enforces the most restrictive scope", () => {
    const b = new BudgetManager({
      workflow: { soft: 1000, hard: 2000 },
      agent: { soft: 10, hard: 20 },
    });
    b.record({ tokens: 15, workflowId: "w", agentId: "ra" });
    // Workflow is fine but agent is over soft → downshift.
    expect(
      b.check({ tokens: 1, workflowId: "w", agentId: "ra" }).decision,
    ).toBe("downshift");
  });
});

describe("SequentialValidator", () => {
  it("runs cheapest first and halts before expensive steps on failure", async () => {
    const order: string[] = [];
    const v = new SequentialValidator();
    const report = await v.run([
      {
        name: "expensive-suite",
        cost: 100,
        run: () => {
          order.push("expensive");
          return { passed: true };
        },
      },
      {
        name: "cheap-typecheck",
        cost: 1,
        run: () => {
          order.push("cheap");
          return { passed: false, detail: "type error" };
        },
      },
    ]);
    expect(order).toEqual(["cheap"]); // expensive never ran
    expect(report.passed).toBe(false);
    expect(report.haltedAt).toBe("cheap-typecheck");
    expect(report.skipped).toContain("expensive-suite");
  });
});

describe("ThreadCompactor", () => {
  it("compacts when over threshold and preserves decision claims", async () => {
    const c = new ThreadCompactor(
      (items) => `Summary of ${items.length} items`,
      { thresholdTokens: 100 },
    );
    const items = [
      { id: "1", title: "A", claims: ["decided X"], approxTokens: 80 },
      { id: "2", title: "B", claims: ["decided Y"], approxTokens: 80 },
    ];
    expect(c.shouldCompact(items)).toBe(true);
    const rec = await c.compact(items);
    expect(rec.preservedDecisionCount).toBe(2);
    expect(rec.tokensBefore).toBe(160);
    expect(rec.compactedItemIds).toEqual(["1", "2"]);
  });
});

describe("Governance mapping", () => {
  it("maps NIST and ISO references to concrete modules", () => {
    expect(GOVERNANCE_MAPPING.length).toBeGreaterThan(5);
    const nistGovern = GOVERNANCE_MAPPING.filter(
      (m) => m.framework === "NIST_AI_RMF" && m.reference === "Govern",
    );
    expect(nistGovern.length).toBeGreaterThan(0);
    // Advanced coordination must be marked scaffolded, not implemented.
    const adv = GOVERNANCE_MAPPING.find((m) =>
      m.control.includes("Chain-of-Debates"),
    );
    expect(adv?.status).toBe("scaffolded");
  });

  it("produces a readable summary", () => {
    expect(governanceSummary()).toContain("Governance Mapping");
  });
});

describe("Advanced strategies (gated)", () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.HARP_ENABLE_ADVANCED_STRATEGIES;
    delete process.env.HARP_ENABLED_STRATEGIES;
    delete process.env.HARP_MODEL_VALIDATED;
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it("are DISABLED by default and fall back to the safe sequence", () => {
    const policy = new StrategyActivationPolicy();
    const cod = new ChainOfDebatesStrategy(policy);
    expect(cod.isActive()).toBe(false);
    // Falls back to full sequential-review loop, not the debate sequence.
    expect(cod.selectSequence({ task: task() })).toEqual([
      "pharaoh",
      "horus-nexus",
      "anubis-sentinel",
      "ra",
      "horus-nexus",
      "anubis-sentinel",
      "pharaoh",
    ]);
  });

  it("stay disabled if enabled in config but model NOT validated", () => {
    process.env.HARP_ENABLE_ADVANCED_STRATEGIES = "true";
    process.env.HARP_ENABLED_STRATEGIES = "chain-of-debates";
    // HARP_MODEL_VALIDATED intentionally unset.
    const policy = new StrategyActivationPolicy();
    expect(policy.evaluate("chain-of-debates").allowed).toBe(false);
    expect(policy.evaluate("chain-of-debates").reason).toMatch(
      /validation not confirmed/i,
    );
  });

  it("activate ONLY when enabled AND model-validated", () => {
    process.env.HARP_ENABLE_ADVANCED_STRATEGIES = "true";
    process.env.HARP_ENABLED_STRATEGIES = "chain-of-debates,aufheben";
    process.env.HARP_MODEL_VALIDATED = "true";
    const policy = new StrategyActivationPolicy();
    expect(policy.evaluate("chain-of-debates").allowed).toBe(true);
    expect(policy.evaluate("aufheben").allowed).toBe(true);
    // Not listed → still disabled.
    expect(policy.evaluate("loose-coalitions").allowed).toBe(false);

    const cod = new ChainOfDebatesStrategy(policy);
    expect(cod.isActive()).toBe(true);
    // Now yields the debate sequence (multiple reviewer passes).
    const seq = cod.selectSequence({ task: task() });
    expect(seq.filter((a) => a === "horus-nexus").length).toBeGreaterThan(1);
  });

  it("emits an audit event when activation is refused", async () => {
    const audit = new InMemoryAuditLogger();
    const policy = new StrategyActivationPolicy(audit);
    await policy.authorize("aufheben", { workflowId: "w", taskId: "t" });
    const events = await audit.list();
    expect(
      events.some((e) => e.action === "strategy.activation_refused"),
    ).toBe(true);
  });

  it("builds all three advanced strategies sharing one policy", () => {
    const strategies = buildAdvancedStrategies(new StrategyActivationPolicy());
    expect(strategies).toHaveLength(3);
    expect(strategies.every((s) => !s.isActive())).toBe(true);
  });
});
