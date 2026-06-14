# Multimodal Stack Governance PR Review Checklist

## Branch

`multimodal-stack-governance`

## Purpose

Promote verified Maxine multimodal stack governance documentation into HARP-Core.

## Files Added

- `docs/multimodal/MULTIMODAL_ROUTING_MAP.md`
- `docs/multimodal/HARP_CORE_MULTIMODAL_PROMOTION_MANIFEST.md`
- `policies/multimodal-routing-policy.json`

## Review Requirements

- [ ] Confirms local multimodal stack lanes are documented.
- [ ] Confirms routing rules are documented.
- [ ] Confirms artifact ledger governance is documented.
- [ ] Confirms release gate governance is documented.
- [ ] Confirms no model weights were promoted.
- [ ] Confirms no generated artifacts were promoted.
- [ ] Confirms no logs were promoted.
- [ ] Confirms no `.venv`, cache, or runtime folders were promoted.
- [ ] Confirms no secrets, tokens, private keys, or `.env` files were promoted.
- [ ] Confirms public/client-facing release still requires human approval and Anubis audit.

## Governance Summary

Local Trustline proves the runtime.

HARP-Core records the approved architecture.

Runtime artifacts stay local.

Secrets never move.

Models may explore. H.A.R.P. must approve. Anubis must audit. Humans decide release.
