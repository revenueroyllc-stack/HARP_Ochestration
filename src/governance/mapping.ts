/**
 * H.A.R.P.™ — Governance control mapping (ISO/IEC 42001 & NIST AI RMF).
 *
 * Maps recognised governance framework functions to the CONCRETE controls
 * implemented in this codebase. This is not marketing text: each entry names a
 * framework reference and the actual module/mechanism that satisfies it, so the
 * mapping can be rendered into an audit-readiness report and kept honest as the
 * code evolves.
 *
 * NIST AI RMF defines four functions — Govern, Map, Measure, Manage — for
 * managing AI risk. ISO/IEC 42001 is the AI management-system standard; its
 * high-level structure includes Leadership (Cl.5), Planning (Cl.6), and
 * Performance Evaluation (Cl.9). The mapping below ties those to H.A.R.P.
 *
 * COMPLIANCE NOTE: this mapping supports audit readiness. It does NOT by itself
 * constitute certification; HIPAA/PCI/SOC 2/ISO certification requires external
 * review of the deployed system and its procedures.
 */

export type Framework = "NIST_AI_RMF" | "ISO_42001";

export type NistFunction = "Govern" | "Map" | "Measure" | "Manage";

export interface ControlMapping {
  framework: Framework;
  /** Function (NIST) or clause (ISO). */
  reference: string;
  /** What the framework asks for. */
  requirement: string;
  /** The concrete H.A.R.P. control that addresses it. */
  control: string;
  /** Module(s) implementing the control. */
  implementedBy: string[];
  status: "implemented" | "scaffolded" | "planned";
}

export const GOVERNANCE_MAPPING: ControlMapping[] = [
  // ---- NIST AI RMF: Govern ----
  {
    framework: "NIST_AI_RMF",
    reference: "Govern",
    requirement:
      "Define roles, responsibilities, permissions, and accountability for the AI system.",
    control:
      "Core Four agents have fixed roles; least-privilege permission map enforced at runtime.",
    implementedBy: [
      "src/core/agentConfig.ts",
      "src/security/PermissionGuard.ts",
      "src/tools/ToolRegistry.ts",
    ],
    status: "implemented",
  },
  {
    framework: "NIST_AI_RMF",
    reference: "Govern",
    requirement: "Human oversight and approval authority over high-impact actions.",
    control: "Approval gate blocks state-changing work pending human sign-off.",
    implementedBy: ["src/security/ApprovalGate.ts", "src/orchestration/HarpOrchestrator.ts"],
    status: "implemented",
  },
  // ---- NIST AI RMF: Map ----
  {
    framework: "NIST_AI_RMF",
    reference: "Map",
    requirement:
      "Identify task context, risk level, data involved, and approval requirements.",
    control:
      "Tasks carry explicit risk level and flags (repo write, secrets, reversibility); strategy selection classifies before execution.",
    implementedBy: ["src/core/types.ts", "src/orchestration/StrategySelector.ts"],
    status: "implemented",
  },
  // ---- NIST AI RMF: Measure ----
  {
    framework: "NIST_AI_RMF",
    reference: "Measure",
    requirement:
      "Measure model cost, latency, token spend, error rates, and risk findings.",
    control:
      "OpenTelemetry-shaped traces/metrics; per-call cost records; multi-scope budget tracking.",
    implementedBy: [
      "src/observability/types.ts",
      "src/models/ModelRouter.ts",
      "src/models/BudgetManager.ts",
    ],
    status: "implemented",
  },
  // ---- NIST AI RMF: Manage ----
  {
    framework: "NIST_AI_RMF",
    reference: "Manage",
    requirement:
      "Manage risk via mitigation, fallback strategies, budget controls, and incident handling.",
    control:
      "Tiered failover with no silent downgrade; budget downshift/cutoff; structured failure results.",
    implementedBy: [
      "src/gateway/concierge/Concierge.ts",
      "src/models/BudgetManager.ts",
      "src/orchestration/HarpOrchestrator.ts",
    ],
    status: "implemented",
  },
  // ---- ISO/IEC 42001: Leadership (Cl.5) ----
  {
    framework: "ISO_42001",
    reference: "Clause 5 (Leadership)",
    requirement: "Establish clear roles and accountability for the AI management system.",
    control: "Documented agent roles and human-led orchestration (managed-contractor model).",
    implementedBy: ["src/core/agentConfig.ts", "AGENTS.md", "AIOS_PROTOCOL.md"],
    status: "implemented",
  },
  // ---- ISO/IEC 42001: Planning (Cl.6) ----
  {
    framework: "ISO_42001",
    reference: "Clause 6 (Planning)",
    requirement: "Conduct AI system impact assessment and risk-based planning.",
    control: "Risk classification and coordination-strategy scoring per task.",
    implementedBy: ["src/orchestration/StrategySelector.ts"],
    status: "implemented",
  },
  // ---- ISO/IEC 42001: Performance Evaluation (Cl.9) ----
  {
    framework: "ISO_42001",
    reference: "Clause 9 (Performance Evaluation)",
    requirement:
      "Monitor, measure, and audit the AI system; retain reconstructable records.",
    control:
      "Append-only audit log queryable by workflow/task/actor; metadata-only telemetry.",
    implementedBy: ["src/storage/AuditLogger.ts", "src/observability/types.ts"],
    status: "implemented",
  },
  // ---- Transport / identity ----
  {
    framework: "NIST_AI_RMF",
    reference: "Govern",
    requirement: "Secure service-to-service communication and workload identity.",
    control:
      "Mutual TLS between concierge and containers; pluggable cert provider; production fail-closed on dev material; SPIFFE/Vault-ready.",
    implementedBy: [
      "src/gateway/security/mtls.ts",
      "src/gateway/security/CertificateProvider.ts",
      "src/gateway/security/certProviders.ts",
    ],
    status: "implemented",
  },
  // ---- Advanced coordination (scaffolded, gated) ----
  {
    framework: "NIST_AI_RMF",
    reference: "Manage",
    requirement:
      "Support advanced risk-reduction coordination patterns under explicit control.",
    control:
      "Chain-of-Debates, Loose Coalitions, and Aufheben strategies are registered, audited, and config-gated — DISABLED pending real-model validation.",
    implementedBy: ["src/orchestration/strategies/advanced/"],
    status: "scaffolded",
  },
];

/** Produce a plain-text audit-readiness summary from the mapping. */
export function governanceSummary(): string {
  const byStatus = (s: ControlMapping["status"]) =>
    GOVERNANCE_MAPPING.filter((m) => m.status === s).length;
  return [
    "H.A.R.P. Governance Mapping (ISO/IEC 42001 & NIST AI RMF)",
    `Implemented controls: ${byStatus("implemented")}`,
    `Scaffolded (gated) controls: ${byStatus("scaffolded")}`,
    `Planned controls: ${byStatus("planned")}`,
    "",
    "Note: mapping supports audit readiness; certification requires external review.",
  ].join("\n");
}
