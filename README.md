# H.A.R.P.™ — Production-Grade Core

Hierarchical Agentic Review & Production System. This is the modular
implementation of the architecture described in `AGENTS.md`, `READ.me`, and
`AIOS_PROTOCOL.md`, replacing the single-file bootstrap.

## What this build delivers

The four priorities, completed in full:

1. **CoordinationStrategy layer** (`src/orchestration/strategies/`,
   `StrategySelector.ts`). The orchestrator owns no fixed sequence. Six
   strategies — sequential-review, parallel-review, arbitration, negotiation,
   voting, escalation — are scored on cost, time, quality, risk, and approval
   burden (AIOS §5.3) and chosen per §5.4 (safety > quality > cost/time).
   Critical risk, secrets, or irreversibility force escalation.

2. **Runtime enforcement.** `PermissionGuard` and `ApprovalGate` are now
   load-bearing. The `ToolRegistry` checks permission and approval before every
   tool call and returns structured `ToolResult`s instead of throwing. Ra's
   output is always approval-gated; the workflow halts at `approval_required`
   when a human approval provider denies.

3. **Real structured agent output.** `BaseAgent` requests JSON from the model
   (via `ModelRouter`, never a provider directly) and parses it defensively
   into the §26 output standard (summary / findings / risks / recommendations /
   unknowns / nextSafeStep / assumptions, plus code-work details for Ra).
   Malformed output degrades to a safe `blocked` result rather than fabricating
   findings.

4. **Full module split** matching the target `src/` layout in all three spec
   docs.

## Architecture

```
src/
  core/          types, agentConfig, constants
  agents/        BaseAgent + Core Four + AgentRegistry
  orchestration/ HarpOrchestrator, ContextManager, StrategySelector, strategies/
  models/        ModelRouter (cost tracking + budget), providers/StubModelProvider
  tools/         ToolRegistry (permission + approval gating), defaultTools
  security/      PermissionGuard, ApprovalGate
  storage/       AuditLogger (append-only, queryable), MemoryStore
  knowledge/     KnowledgeStore
  index.ts       composition root + demo
```

### Data flow

```
Task ──► StrategySelector (score 6 strategies) ──► chosen sequence
      ──► for each agent:
            ContextManager.createScopedContext  (role-scoped, summaries only)
            Agent.execute ──► ModelRouter ──► Provider ──► parse JSON ──► AgentResult
            persist artifacts ──► MemoryStore
            if Ra: ApprovalGate.evaluate ──► block or continue
      ──► WorkflowResult (completed | approval_required | failed)
```

Every step writes an `AuditEvent` (start, each agent start/complete, tool
calls, approval evaluations, completion/failure), queryable by workflow, task,
actor, risk, or approval state.

## Key governance properties

- **Least privilege:** agents act only within their permission map; the tool
  registry denies anything else.
- **Approval-first:** state-changing work cannot proceed without explicit
  approval. The default `ConsoleApprovalProvider` *denies* by design so missing
  human-approval integration fails loud, not silent.
- **Uncorrelated context (AIOS §6):** downstream agents receive artifact
  *claims*, not the prior agent's full reasoning; Anubis runs adversarial mode
  on high-risk tasks.
- **Structured failure (AIOS §23):** failures are audited and returned with the
  failed phase/actor, reason, audit id, and recovery step — completed artifacts
  are preserved.
- **Budget enforcement (AIOS §13.5):** the router tracks per-workflow tokens and
  raises `TokenBudgetExceededError`, which the orchestrator converts to a clean
  failed result recommending a model downshift.

## Commands

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc
npm run dev         # tsx src/index.ts  (runs the demo)
npm test            # vitest run (16 tests)
```

## Tests (AIOS §24)

Registry builds all four agents · permission guard blocks unauthorized access ·
tool registry denies unpermitted and unapproved tools, allows approved ones ·
approval gate blocks high-risk repo writes · context manager scopes per agent ·
strategy selector picks sequential-review and forces escalation correctly ·
orchestrator runs the expected sequence and audits start/completion · Ra output
requires approval · Anubis flags security-sensitive actions · Pharaoh produces a
final recommendation · budget exhaustion returns a failed result.

## Swapping implementations

Everything depends on interfaces. To go to production, change only
`src/index.ts`: inject a real `ModelProvider` (OpenAI/Anthropic/Ollama/vLLM), a
Postgres-backed `AuditLogger` and `MemoryStore`, and a real `ApprovalProvider`
(dashboard / PR review / signed approval event).

© Revenue Roy LLC — H.A.R.P.™
