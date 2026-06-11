# H.A.R.P. Model Containment Policy

## Purpose

This policy defines how model workers are contained so they cannot mutate, rescale, self-update, self-download, spawn tools, access Docker, access secrets, or bypass H.A.R.P.

## Authority Boundary

- Horus Nexus controls model routing.
- Anubis Sentinel controls risk, approval, and audit.
- Ra Oracle controls memory and truth.
- Pharaoh controls access, tenancy, secrets, and enforcement boundaries.
- Model workers only process approved API requests.

The model is never the authority layer.

## Required Model Worker Shape

Every model worker must be:

- API-only
- non-root
- read-only at the root filesystem level
- read-only for model weights
- private-networked
- fixed-context
- fixed-concurrency
- fixed-resource
- pinned to an explicit image digest or approved image tag
- unreachable from public internet
- callable only through H.A.R.P.

## Forbidden Model Worker Capabilities

Model workers must not have:

- Docker socket mounts
- privileged mode
- host filesystem mounts
- production secrets
- direct database credentials
- direct billing/mail/SMS credentials
- shell tools exposed to the model
- automatic model downloads
- automatic fallback upgrades
- automatic context expansion
- public ports
- unrestricted internet egress

## The Non-Rescale Standard

Nothing rescales means:

- containers do not multiply without approval
- workers do not multiply without approval
- models do not silently change size
- context windows do not silently grow
- concurrency does not silently increase
- fallback does not silently upgrade
- GPU usage does not silently expand
- model workers do not mutate or self-update

## Promotion Rule

This policy is canonical in HARP-Core. Elevate F.A.C.E. OS and Maxine AI-Trustline may consume this policy, but must not define conflicting model containment rules independently.
