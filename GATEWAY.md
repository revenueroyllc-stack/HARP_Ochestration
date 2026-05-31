# H.A.R.P.™ — Model Gateway (Concierge / Container architecture)

This document describes the model-provider gateway: how H.A.R.P. talks to AI
models without the core ever knowing which model is in use, and without PII
crossing the wire.

## The mental model

```
   CORE (agents, orchestrator, ModelRouter)
        │  speaks only the ModelProvider interface
        ▼
   CONCIERGE                         ← carries messages; holds NO provider, NO secrets
        │  1. redact PII
        │  2. plan route (tiered)
        │  3. deliver over mutual TLS
        │  4. retry / failover
        ▼  (HTTPS + mTLS, internal Docker network only)
   CONTAINER(s)                      ← sealed room; provider lives & works here
        │  provider owns API keys + SDK calls
        ▼
   UPSTREAM MODEL (OpenAI / Anthropic / Ollama / …)
```

The **Concierge** delivers messages to a **Container** that **houses the
provider**; the provider does its work inside the container and hands the
result back to the Concierge, which returns it to the core. The core only ever
sees the `ModelProvider` interface — it cannot tell whether it is talking to an
in-process stub or a fleet of remote containers.

## Why it is built this way

- **Providers live outside the core.** The core depends on an interface, never a
  concrete provider. Swapping or adding a provider never touches core code.
- **Interchangeable at all times.** Which container serves a request is chosen
  at run time by the router. Add a container, the system uses it; remove one, it
  routes around it.
- **No PII on the wire.** The Concierge redacts identifiers (email, phone, SSN,
  card numbers, IPs, secrets/tokens) *before* building the message that crosses
  the boundary. The strongest protection for data in transit is not to transmit
  it.
- **Mutual TLS.** Concierge and containers each present a CA-signed certificate
  and verify the other. Even on the internal network, no unauthenticated party
  can speak on the channel. TLS 1.3 minimum.
- **No public exposure.** In `docker-compose.yml`, containers sit on an
  `internal: true` network and publish no host ports. The only thing that can
  reach them is the Concierge.
- **Tiered failover, no silent downgrade.** Policy: retry same container →
  same-class backup → report to core. For high-risk work the route is
  same-class only; if no same-class container is healthy, the Concierge reports
  failure rather than substituting a weaker model.

## Components

| Component | Path | Role |
|-----------|------|------|
| Wire contract | `src/gateway/contracts/wire.ts` | The message envelope both sides share. |
| Redactor | `src/gateway/redaction/Redactor.ts` | Strips PII before the wire. |
| mTLS config | `src/gateway/security/mtls.ts` | Loads certs; builds TLS options. |
| Safe logger | `src/gateway/security/SafeLogger.ts` | Metadata-only logging; cannot log payloads. |
| Router | `src/gateway/routing/Router.ts` | Container registry + tiered route plan. |
| Concierge | `src/gateway/concierge/Concierge.ts` | Orchestrates redact→route→deliver→failover. |
| Transport | `src/gateway/concierge/MtlsHttpTransport.ts` | mTLS HTTPS delivery. |
| Container server | `container/src/server.ts` | mTLS HTTPS server housing one provider. |
| Contained provider | `container/src/Provider.ts` | The provider interface + stub. |
| Selection | `src/modelProvider.ts` | Chooses stub vs concierge from env. |

## Running it

### Local, offline (default)

```bash
npm run dev        # HARP_MODEL_MODE defaults to "stub"; no network, no certs
```

### Full secure gateway

1. Generate development certificates (a private CA + concierge + container certs):

   ```bash
   npm run certs
   ```

2. Start the container fleet on the internal network:

   ```bash
   npm run containers:up      # docker compose up --build -d
   ```

3. Point the core at the Concierge via environment variables:

   ```bash
   export HARP_MODEL_MODE=concierge
   export HARP_CONCIERGE_CERT=./certs/concierge.crt
   export HARP_CONCIERGE_KEY=./certs/concierge.key
   export HARP_CONCIERGE_CA=./certs/ca.crt
   export HARP_CONTAINERS='[
     {"id":"stub-primary","baseUrl":"https://harp-container-primary:8443","tier":"primary","classes":["cloud-reasoning","cloud-coding","frontier-reasoning"],"providerFamily":"stub"},
     {"id":"stub-backup","baseUrl":"https://harp-container-backup:8443","tier":"backup","classes":["cloud-reasoning","cloud-coding","frontier-reasoning"],"providerFamily":"stub"}
   ]'
   npm run dev
   ```

## Connecting a real model

Edit one file inside the container — `container/src/index.ts` — to construct a
real provider in place of `StubContainedProvider`. The provider implements a
single `generate()` method, owns its API key (injected via Docker secret / env
inside the container only), and calls the upstream SDK. Nothing in the
Concierge or core changes.

## Security checklist (operator responsibilities)

- [ ] Replace dev certs with certificates from your real internal CA / mesh.
- [ ] Inject provider API keys via Docker secrets or a vault — never in the repo.
- [ ] Keep `certs/` and `.env*` git-ignored (already configured).
- [ ] Define your own redaction policy: what counts as PII for your users, and
      what your model vendors are contractually allowed to receive. The default
      redactor is a mechanism, not a compliance guarantee.
- [ ] Review data flow with security/compliance before processing real customer
      data.

## Tests

`tests/gateway.e2e.test.ts` starts real mTLS HTTPS servers and verifies: the
end-to-end success path, PII redaction before the container, retry-then-failover
to a same-class backup, the high-risk no-downgrade guarantee, and rejection of a
client presenting no certificate.

© Revenue Roy LLC — H.A.R.P.™

---

# Production PKI, mTLS, and PII Redaction Policy

This section defines the trust model H.A.R.P. enforces. It is binding policy,
not aspiration: the rules below are encoded in `CertificateProvider.ts` /
`certProviders.ts` and enforced at startup (fail closed).

## 1. Local development certificate behavior

`npm run certs` generates a local development CA plus concierge and container
certificates. This is a **developer convenience for local use only**. The dev
CA embeds a marker in its subject (`DEV-CERT-DO-NOT-USE-IN-PRODUCTION`) so the
runtime can positively identify and reject it outside development.

Development is the default deployment mode (`HARP_DEPLOYMENT_MODE=development`).
In this mode, dev certs are accepted so the full secure pipe can be exercised
offline.

## 2. Production certificate requirements

In `HARP_DEPLOYMENT_MODE=production`:

- Dev-generated CA material is **prohibited** and rejected at startup.
- mTLS material must come from a trusted internal CA, a managed PKI system, or a
  workload-identity platform.
- Certificates should be **short-lived and automatically rotated**.
- Private keys must never be committed to the repo, baked into images, shared
  manually, or produced by the dev-cert script. Keys should be generated in
  memory by the issuing system wherever possible.
- Identity should be **workload-based**, not host-based or developer-based.
- Startup **fails closed** if material is missing, unparseable, expired,
  not-yet-valid, or identifiably from the dev CA.
- There is **no silent downgrade** from mTLS to insecure HTTP anywhere in the
  codebase. The only transport is mutual-TLS HTTPS (TLS 1.3 floor).

## 3. Approved production PKI sources

Selected via `HARP_CERT_SOURCE`:

| Source | Value | Status |
|--------|-------|--------|
| Workload identity (SPIFFE/SPIRE) | `spiffe` | Interface ready; integration deferred to target env. |
| Managed private CA (Vault PKI) | `vault` | Interface ready; integration deferred to target env. |
| Files from an internal CA | `file` | Available now (also used by dev). Org-issued CA files are an acceptable **temporary** fallback. |

The cert-loading layer is a pluggable `CertificateProvider`. Adding SPIFFE or
Vault is implementing one interface method and selecting it via config — it does
**not** require changes to the concierge, container server, or core.

## 4. Recommended SPIFFE/SPIRE path

For container-to-container identity, SPIFFE/SPIRE is the recommended target. Each
workload receives a short-lived SVID via the Workload API, rotated continuously,
with keys never written to disk. Implement `SpiffeCertificateProvider.load()`
against the Workload API socket for the chosen environment, then set
`HARP_CERT_SOURCE=spiffe`. Until implemented, the provider fails closed with a
clear message rather than degrading.

## 5. Recommended Vault PKI / managed CA path

Where a service mesh is not in use, HashiCorp Vault's PKI engine (or a cloud
managed private CA) issues short-lived certs on demand with automatic renewal.
Implement `VaultCertificateProvider.load()` against the Vault issue endpoint with
a short TTL and a renewal loop, then set `HARP_CERT_SOURCE=vault`.

## 6. Explicit prohibition on dev CA material in production

This is enforced in code: `enforceTrustPolicy()` calls `looksLikeDevMaterial()`
and throws `CertificatePolicyError` when dev material is presented in production.
The container and concierge both run this check before serving or sending a
single request.

## 7. Runtime fail-closed behavior

At startup, every party (each container, the concierge):

1. Resolves the deployment mode.
2. Loads material from the configured source.
3. Validates it is well-formed X.509 and within its validity window.
4. Rejects dev material in production.
5. On any failure, throws and the process exits non-zero. It never starts an
   insecure listener and never falls back to plaintext.

## 8. Audit logging expectations

Certificate issuance, renewal, validation failures, downgrade attempts, and
mTLS rejections must be auditable. The gateway emits metadata-only structured
log events (`container.listening`, `container.startup_failed`,
`concierge.*`) carrying deployment mode, cert source, and failure reasons — but
never key material or request payloads. When wired to SPIFFE/Vault, issuance and
renewal events from those systems should be forwarded into the same audit trail.

## 9. Separation of transport security and PII/redaction policy

**mTLS protects the channel. It does not decide what data may travel on it.**
Mutual TLS guarantees that only authenticated workloads exchange messages and
that the traffic is encrypted. It says nothing about whether a given field
*should* be sent to a model provider, stored, or logged. Those are separate
decisions, addressed next.

## 10. PII / redaction policy boundary

The concierge runs a `Redactor` over every prompt before it crosses the wire,
and the default redactor masks common identifiers (email, phone, SSN, card
numbers, IPs, secret tokens). This is a **mechanism**. The actual policy must be
defined separately by the operator and must specify, at minimum:

- What data counts as PII for this deployment.
- What must be redacted before any model/provider call.
- What may be stored in logs, and what must never be logged.
- Retention periods for any stored data.
- Audit-trail requirements.
- Vendor / data-processing-agreement requirements for each model provider.
- Human-review requirements for sensitive workflows.

Supply a custom `Redactor` to enforce deployment-specific rules.

## 11. Compliance note

The controls above are designed to support a strong security posture. They do
**not**, by themselves, constitute certification. Claims such as HIPAA, PCI-DSS,
or SOC 2 readiness require external security and compliance review of the
deployed system, its data flows, and its operating procedures. Such claims must
not be made on the basis of this codebase alone.

© Revenue Roy LLC — H.A.R.P.™
