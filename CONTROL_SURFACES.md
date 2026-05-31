# H.A.R.P.™ — Control Surfaces & Gated Intelligence

This document describes the layer added to make H.A.R.P. a serious, governed
product rather than a demo: the **control surfaces** that manage cost, context,
observability, and governance — and the **gated coordination strategies** that
are architecturally supported but disabled until real-model validation.

Design principle: **build the control surfaces now, activate the intelligence
later.** Architectural support is real engineering; running unvalidated
coordination logic on a stub provider is theatre. Everything here is testable
today; nothing dangerous is enabled.

---

## Real-now control surfaces (implemented & tested)

### Progressive context loading (`src/context/ProgressiveContextLoader.ts`)
Skill-style, metadata-first loading. Each skill advertises cheap metadata
(name + description) that is always available; its full body is loaded
just-in-time only when selected, and heavy external references only on explicit
request. Three levels (metadata → body → external docs) keep the working context
in the "smart zone." Token cost is tracked per level for budgeting and emitted
as telemetry.

### Resource-aware model routing & fan-out (`src/models/ResourceAwareRouter.ts`)
A pure policy that maps a unit of work to a model class: cheap/fast models for
extraction and research, reasoning/coding models for review, frontier/specialist
models for synthesis and security. High and critical risk **upgrade and never
downgrade**, consistent with the gateway's no-silent-downgrade rule. `planFanOut`
produces N cheap parallel workers plus one expensive synthesis step, clamped to a
configurable maximum.

### Budget hardening (`src/models/BudgetManager.ts`)
Multi-scope budgets (per-agent, per-workflow, per-day) with two graded responses:
a **downshift** signal at a soft threshold (drop to a cheaper class) and a
**cutoff** at the hard limit (refuse further spend, fail closed). The most
restrictive scope wins.

### Sequential cheap-test-first validation (`src/orchestration/SequentialValidator.ts`)
Runs validation steps cheapest-first and halts the moment one fails, so an
expensive token-heavy suite never runs after a fast check has already failed.

### Thread compaction (`src/context/ThreadCompactor.ts`)
When accumulated context crosses a token threshold, compacts items into a written
record and preserves decision claims explicitly — so long workflows avoid the
"dumb zone" without silently dropping governance-relevant facts.

### Observability (`src/observability/`)
OpenTelemetry-shaped traces, metrics, and logs behind vendor-neutral interfaces.
The in-memory implementation makes telemetry assertable in tests and runs
offline; swapping in a real OTLP exporter (Jaeger/Tempo/X-Ray, Prometheus) is a
composition-root change. Like the gateway's logger, the telemetry API is
metadata-only by construction — there is no method to attach prompt or response
payloads, so observability cannot become a PII leak.

### Governance mapping (`src/governance/mapping.ts`)
A structured, queryable mapping from NIST AI RMF functions (Govern, Map, Measure,
Manage) and ISO/IEC 42001 clauses (Leadership, Planning, Performance Evaluation)
to the concrete modules that satisfy them. Each entry names the framework
reference, the requirement, the H.A.R.P. control, and the implementing files,
with a status (`implemented` / `scaffolded` / `planned`). It renders into an
audit-readiness summary and is kept honest as the code evolves.

> NIST AI RMF organises AI risk management into Govern, Map, Measure, and Manage.
> ISO/IEC 42001 is the AI management-system standard. This mapping supports audit
> readiness; it does **not** by itself constitute certification, which requires
> external review of the deployed system and its procedures.

---

## Gated coordination strategies (scaffolded, disabled)

The advanced multi-agent patterns from the research feedback —
**Chain of Debates**, **Loose Coalitions**, and the **Aufheben dialectical
protocol** — are implemented as first-class strategies that satisfy the
`CoordinationStrategy` contract, carry documented audit-event schemas, and are
**disabled by default**.

### Why gated, not running
On a stub provider these strategies are meaningless: three identical stub
responses do not "debate." Running them now would be unvalidated machinery. So
they are present as architecture — registered, documented, auditable — but inert.

### The activation policy (`.../advanced/ActivationPolicy.ts`)
An advanced strategy runs **only if BOTH** conditions hold:

1. **Explicit config opt-in** — `HARP_ENABLE_ADVANCED_STRATEGIES=true` and the
   strategy named in `HARP_ENABLED_STRATEGIES`.
2. **Real-model validation confirmed** — `HARP_MODEL_VALIDATED=true`.

If either is missing, activation is refused, an audit event
(`strategy.activation_refused`) is written, and the strategy **falls back to the
safe sequential-review loop** — it never fails open into unvalidated behaviour.

### What this lets the product say, truthfully
> "The system supports advanced multi-agent coordination patterns (Chain of
> Debates, Loose Coalitions, Aufheben dialectical synthesis). They are gated,
> auditable, and require explicit activation plus real-model validation before
> they can execute."

That is both stronger and safer than either "we didn't build them" or "agents
form dynamic coalitions autonomously."

### Explicitly NOT built
Consistent with the safety model, none of the following exist anywhere in the
codebase: autonomous self-modification of source code, autonomous commits,
unsupervised overnight execution loops, or any path that runs an advanced
strategy without the two-key activation above.

---

## Tests

`tests/realnow.test.ts` covers: progressive loading (JIT bodies, Level-3 refs),
resource routing (cheap routing + no high-risk downgrade + fan-out clamping),
budget downshift/cutoff and most-restrictive-scope, sequential halt-on-cheap-
failure, compaction with preserved decisions, governance mapping integrity, and
the full gating matrix for advanced strategies (disabled by default; disabled
when enabled-but-unvalidated; active only when enabled AND validated; audit event
on refusal).

© Revenue Roy LLC — H.A.R.P.™
