# H.A.R.P.™

**Hierarchical Agentic Review & Production System**

A modular, governed, multi-agent orchestration framework that turns AI models
into a coordinated software-operations team — one that reviews, validates, and
challenges its own work before anything reaches a human for approval.

H.A.R.P. is not a chatbot or a single autonomous coding agent. It is a
controlled, auditable layer that makes AI work on software the way a careful,
well-run team would: with role specialization, permission boundaries, human
approval gates, and a full audit trail.

---

## Core idea

Most AI coding tools are one assistant working alone, jumping straight from
request to changing your code with no review and no record. H.A.R.P. replaces
that with four specialists working in a controlled loop. **The AI proposes; a
human decides.** No high-impact action bypasses review, validation, approval,
and an audit record.

### The Core Four

| Agent | Role | Answers |
|-------|------|---------|
| **Pharaoh** | Executive Orchestrator + Knowledge Librarian | What is the task, who handles it, can it proceed safely? |
| **Horus Nexus** | Observation / Review / Long-term Planning | Is this the correct way to build it? |
| **Anubis Sentinel** | Validation / Risk / Security Monitoring | What could go wrong? |
| **Ra** | Generation / Creation / Scheduling / Automation | How do we build it? |

---

## Quick start

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc
npm run dev         # run the demo workflow (offline, stubbed model)
npm test            # 47 tests
```

The demo runs a complete workflow end to end. It correctly halts at
`approval_required` for high-risk work — that is the system working as designed.

> **Status:** the orchestration, governance, security, routing, budgets,
> observability, and gating are real and tested today. The model behind the
> agents is a stub by default; connecting a real provider is the one remaining
> step that turns the framework into something that reasons. It is designed so
> that swap touches only the container.

---

## Architecture

```
src/
  core/            types, agent config, constants
  agents/          BaseAgent + Core Four + AgentRegistry
  orchestration/   HarpOrchestrator, ContextManager, StrategySelector,
                   SequentialValidator, strategies/ (+ advanced/, gated)
  models/          ModelRouter, ResourceAwareRouter, BudgetManager, providers/
  context/         ProgressiveContextLoader, ThreadCompactor
  observability/   OpenTelemetry-shaped traces / metrics / logs
  governance/      ISO 42001 & NIST AI RMF control mapping
  gateway/         Concierge -> container model gateway (mTLS), redaction,
                   routing, certificate providers
  security/        PermissionGuard, ApprovalGate
  storage/         AuditLogger (append-only), MemoryStore
  knowledge/       KnowledgeStore
  index.ts         composition root + demo

container/         the sealed service that houses a model provider (mTLS HTTPS)
scripts/           dev certificate generation
```

### How it works

A task flows through a coordination strategy chosen by score (risk, cost,
quality, approval burden). Each agent receives role-scoped context, calls the
model only through the `ModelRouter` (never a provider directly), and produces a
structured result. Ra's output is always approval-gated. Every step writes an
audit event. State-changing work cannot proceed without explicit human approval.

Models live **outside** the core, inside containers reached through the
**Concierge** — a messenger that redacts PII before anything crosses the wire,
delivers over mutual TLS on an internal-only network, and applies tiered
failover (retry -> same-class backup -> report to core) with no silent downgrade.

---

## What's built

**Governance & safety:** least-privilege permissions enforced at runtime, human
approval gates, append-only auditable history, ISO 42001 / NIST AI RMF control
mapping.

**Model gateway:** Concierge/container separation, mutual TLS (TLS 1.3),
PII redaction before the wire, multi-container routing with tiered failover,
pluggable certificate providers with a production fail-closed policy
(dev certs rejected in production), SPIFFE/Vault-ready.

**Cost & context control surfaces:** progressive (skill-style, metadata-first)
context loading, resource-aware model routing and fan-out, multi-scope budgets
with downshift and cutoff, sequential cheap-test-first validation, thread
compaction, OpenTelemetry-shaped observability.

**Advanced coordination (scaffolded, disabled):** Chain of Debates, Loose
Coalitions, and the Aufheben dialectical protocol are registered, documented,
and auditable — but gated off and require both explicit opt-in and real-model
validation before they can execute. They fall back to the safe sequential-review
loop otherwise; they never fail open.

**Explicitly not built**, by design: autonomous self-modification of source
code, autonomous commits, and unsupervised execution loops.

---

## Running the secure gateway (optional)

```bash
npm run certs           # generate LOCAL DEV certificates only
npm run containers:up   # start the container fleet on an internal network
npm run containers:down
```

Then point the core at the Concierge via environment variables (see `GATEWAY.md`).
Production must supply certificates from a real PKI or workload-identity system;
dev certificates are rejected in production mode.

---

## Documentation

- **`GATEWAY.md`** — the model gateway, mutual TLS, and the Production PKI / PII
  redaction policy.
- **`CONTROL_SURFACES.md`** — the cost/context/observability/governance layer and
  the gated advanced-strategy activation model.
- **`AGENTS.md`** / **`AIOS_PROTOCOL.md`** — the agent roles, workflow, and
  operating protocols.

---

## Security notes

- Private keys and certificates are git-ignored and never committed.
- Provider API keys live only inside containers, injected at runtime.
- Treat any token that appears in a screenshot or message as compromised;
  delete and reissue it.
- The governance mapping supports audit *readiness*; it does not constitute
  certification. HIPAA / PCI / SOC 2 / ISO claims require external review of the
  deployed system.

---

(c) Revenue Roy LLC — H.A.R.P.(TM)

