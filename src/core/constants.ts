/**
 * H.A.R.P.™ — System-wide constants and tunable thresholds.
 *
 * Centralising these prevents magic numbers from scattering across the
 * codebase and makes governance thresholds auditable in one place.
 */

import type { Permission, RiskLevel } from "./types.js";

/** Risk levels that always force a human approval gate. */
export const APPROVAL_FORCING_RISK: ReadonlySet<RiskLevel> = new Set<RiskLevel>([
  "high",
  "critical",
]);

/**
 * Action substrings that mark a state-changing operation. Kept as a list so
 * new actions can be added without touching gate logic.
 */
export const STATE_CHANGING_ACTION_MARKERS: readonly string[] = [
  "repo.write",
  "repo:write",
  "schedule.create",
  "schedule:create",
  "deploy",
  "migration",
  "secrets",
  "auth.change",
  "billing",
  "delete",
];

/** Permissions considered dangerous and therefore approval-gated when used. */
export const DANGEROUS_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>(["repo:write", "schedule:create"]);

/** Temperature bands by phase (AIOS §14.1). Deterministic phases stay low. */
export const TEMPERATURE = {
  evaluation: 0.1,
  securityReview: 0.1,
  bugInvestigation: 0.1,
  approvalDecision: 0.0,
  codeReview: 0.2,
  implementation: 0.2,
  creative: 0.7,
} as const;

/** Retry ceiling before escalating to a human (AIOS §23.2). */
export const MAX_RETRIES = 2;

/** Numeric weight of each risk level, used in strategy scoring. */
export const RISK_WEIGHT: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Default per-workflow token budget. Pharaoh downshifts or stops if exceeded. */
export const DEFAULT_WORKFLOW_TOKEN_BUDGET = 200_000;

/** Indicators that the working context has rotted (AIOS §6.5). */
export const CONTEXT_ROT_INDICATORS: readonly string[] = [
  "references missing file",
  "contradicts current repo state",
  "relies on outdated decision",
  "unintended scope expansion",
  "treats prior agent output as ground truth",
];
