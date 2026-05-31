/**
 * H.A.R.P.™ — Core type definitions.
 *
 * This module is the single source of truth for shared shapes. No runtime
 * logic lives here; everything is a type or interface so it can be imported
 * anywhere without creating circular dependencies.
 */

// -----------------------------------------------------------------------------
// Identity & enumerations
// -----------------------------------------------------------------------------

export type AgentId = "pharaoh" | "horus-nexus" | "anubis-sentinel" | "ra";

export type Actor = AgentId | "system" | "user";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type WorkflowStatus =
  | "pending"
  | "planning"
  | "review"
  | "validation"
  | "production"
  | "approval_required"
  | "completed"
  | "failed";

export type Permission =
  | "repo:read"
  | "repo:write"
  | "repo:review"
  | "issue:read"
  | "knowledge:read"
  | "knowledge:write"
  | "memory:read"
  | "memory:write"
  | "security:scan"
  | "workflow:plan"
  | "workflow:approve"
  | "schedule:create"
  | "audit:write";

export type ModelClass =
  | "local-fast"
  | "local-reasoning"
  | "cloud-fast"
  | "cloud-reasoning"
  | "cloud-coding"
  | "frontier-reasoning"
  | "embedding"
  | "reranker"
  | "security-specialist"
  | "long-context";

export type ArtifactType =
  | "code"
  | "spec"
  | "doc"
  | "review"
  | "risk_report"
  | "security_report"
  | "schedule"
  | "approval_request"
  | "final_report";

export type CoordinationStrategyName =
  | "sequential-review"
  | "parallel-review"
  | "arbitration"
  | "negotiation"
  | "voting"
  | "escalation";

export type OperationalMode =
  | "teaching"
  | "review"
  | "build"
  | "night-shift"
  | "governance";

// -----------------------------------------------------------------------------
// Tasks & context
// -----------------------------------------------------------------------------

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  requestedBy: string;
  repo?: string;
  issueId?: string;
  riskLevel: RiskLevel;
  /** Number of files the change is expected to touch. Feeds strategy scoring. */
  affectedFiles?: number;
  /** Whether the task ultimately requires writing to a repository. */
  requiresRepoWrite?: boolean;
  /** Whether secrets, credentials, or permission boundaries are involved. */
  touchesSecrets?: boolean;
  /** Whether the change is reversible. Irreversible work escalates. */
  reversible?: boolean;
  createdAt: string;
}

export interface ProjectContext {
  architectureDocs: string[];
  standardOperatingProcedures: string[];
  glossary: Record<string, string>;
  priorDecisions: string[];
  openIssues: string[];
  workflowHistory: string[];
}

/**
 * Context scoped to a single agent for a single workflow phase. The
 * ContextManager builds these; agents never read ProjectContext directly.
 */
export interface ScopedContext {
  task: AgentTask;
  /** Identifiers of the source documents this context was derived from. */
  contextSourceIds: string[];
  /** ISO timestamp at which this context snapshot was taken (freshness). */
  snapshotAt: string;
  architectureDocs: string[];
  standardOperatingProcedures: string[];
  glossary: Record<string, string>;
  priorDecisions: string[];
  openIssues: string[];
  workflowHistory: string[];
  priorArtifacts: ArtifactSummary[];
  constraints: string[];
  /** Facts the agent is missing and should not invent. */
  unresolvedUnknowns: string[];
}

// -----------------------------------------------------------------------------
// Artifacts
// -----------------------------------------------------------------------------

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  author: AgentId;
  timestamp: string;
  /** Traceability links (AIOS §21.4). */
  taskId: string;
  workflowId: string;
  contextSourceIds: string[];
  modelRoute?: ModelClass;
  /** New versions create new artifacts; this links to the prior version. */
  supersedes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A lightweight artifact reference passed between agents. Per the Uncorrelated
 * Context Window Protocol (AIOS §6), downstream agents receive summaries and
 * explicit claims, NOT the full reasoning of the previous agent.
 */
export interface ArtifactSummary {
  id: string;
  type: ArtifactType;
  title: string;
  author: AgentId;
  /** A short, factual claim list — not chain-of-thought. */
  claims: string[];
}

// -----------------------------------------------------------------------------
// Agent results (the §26 output standard)
// -----------------------------------------------------------------------------

export interface CodeWorkDetails {
  filesAffected: string[];
  testPlan: string[];
  rollbackPlan: string[];
  validationCommands: string[];
}

export interface AgentResult {
  agentId: AgentId;
  status: "success" | "blocked" | "failed";
  summary: string;
  findings: string[];
  risks: string[];
  recommendations: string[];
  artifacts: Artifact[];
  approvalRequired: boolean;
  unknowns: string[];
  nextSafeStep: string;
  /** Present only for code-producing work (Ra). */
  codeWork?: CodeWorkDetails;
  /** Assumptions the agent made explicit (AIOS §15.4). */
  assumptions: string[];
}

// -----------------------------------------------------------------------------
// Workflow
// -----------------------------------------------------------------------------

export interface WorkflowResult {
  id: string;
  task: AgentTask;
  status: WorkflowStatus;
  strategy: CoordinationStrategyName;
  artifacts: Artifact[];
  agentResults: AgentResult[];
  approvalRequired: boolean;
  finalRecommendation: string;
  /** Populated when status is "failed". */
  failure?: WorkflowFailure;
  startedAt: string;
  completedAt: string;
}

export interface WorkflowFailure {
  phase: string;
  failedActor: Actor;
  reason: string;
  auditEventId: string;
  recoveryRecommendation: string;
}

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: Actor;
  action: string;
  target?: string;
  workflowId?: string;
  taskId?: string;
  riskLevel?: RiskLevel;
  approvalState?: "not_required" | "required" | "granted" | "denied";
  details: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

export interface ModelRequest {
  modelClass: ModelClass;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** Identifiers used for cost tracking and reproducibility. */
  agentId?: AgentId;
  taskId?: string;
  workflowId?: string;
}

export interface ModelResponse {
  text: string;
  modelUsed: string;
  modelClass: ModelClass;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export interface ModelProvider {
  /** Stable identifier, e.g. "stub", "openai", "anthropic". */
  readonly name: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

export interface ToolResult<T = unknown> {
  toolName: string;
  ok: boolean;
  output?: T;
  error?: string;
  auditId?: string;
}

export interface ToolContext {
  agentId: AgentId;
  task: AgentTask;
  workflowId: string;
  approvalGranted: boolean;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  /** Permission an agent must hold to invoke this tool. */
  requiredPermission: Permission;
  /** Whether invoking the tool changes state and therefore needs approval. */
  stateChanging: boolean;
  run(input: I, context: ToolContext): Promise<O>;
}

// -----------------------------------------------------------------------------
// Approval
// -----------------------------------------------------------------------------

export interface ApprovalDecision {
  required: boolean;
  approved: boolean;
  reason: string;
  approverId?: string;
  timestamp: string;
}

export interface ApprovalRequest {
  task: AgentTask;
  workflowId: string;
  phase: string;
  action: string;
  details: string;
  artifactIds: string[];
}

export interface ApprovalProvider {
  requestApproval(input: ApprovalRequest): Promise<ApprovalDecision>;
}
