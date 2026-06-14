# HARP-Core Multimodal Promotion Manifest

## Status

Local Maxine multimodal stack has been installed, tested, lifecycle-managed, audited, and gated.

This manifest identifies what should be promoted into HARP-Core as canonical architecture/policy documentation.

## Local Runtime Lanes

| Lane | Local Name | Model | Port | Status |
|---|---|---|---|---|
| Code / reasoning | horus-code | Qwen3.6 35B-A3B 8bit MLX | 8080 | Verified |
| Multimodal input | gemma-sense | Gemma 4 12B MLX-VLM | 8081 | Verified |
| Image fast | flux-vision-fast | flux2-klein-base-4b-mlx-8bit | 8082 | Verified |
| Image quality | flux-vision-quality | flux2-dev-4-bit | 8082 | Verified |
| Image max | flux-vision-max | flux2-dev-8-bit | 8082 | Verified |
| Voice | maxine-voice | Qwen3-TTS 12Hz 1.7B Base 8bit | 8083 | Verified |

## Promote to HARP-Core

Promote these as architecture and governance references:

- `multimodal-stack/docs/MULTIMODAL_ROUTING_MAP.md`
- `multimodal-stack/policies/multimodal-routing-policy.json`
- Documentation describing:
  - local multimodal lanes
  - routing rules
  - artifact ledger rules
  - human approval release gate
  - invocation audit rules
  - lifecycle attachment rules

## Do Not Promote

Do not promote any of the following into HARP-Core:

- model weights
- Hugging Face tokens
- `.venv` folders
- cache folders
- generated PNG/WAV artifacts
- local output folders
- private keys
- `.pid` files
- local logs containing machine/runtime details
- API tokens or `.env` files

## Governance Rules

1. Generated artifacts are sandbox-only by default.
2. External release requires human approval.
3. Release-ready does not mean published.
4. Direct publish/send/upload is not automatic.
5. Anubis audit is required for public/client-facing use.
6. H.A.R.P. routes the work; workers execute only within their lane.
7. Secrets and credentials remain local or in approved secret managers only.

## Promotion Method

Promotion must happen through a reviewed HARP-Core branch.

Suggested branch name:

`multimodal-stack-governance`

Suggested HARP-Core destination paths:

- `docs/multimodal/MULTIMODAL_ROUTING_MAP.md`
- `docs/multimodal/MULTIMODAL_ARTIFACT_GOVERNANCE.md`
- `policies/multimodal-routing-policy.json`
- `docs/MAXINE_MULTIMODAL_STACK.md`

## Current Local Commands

Lifecycle:
- `multimodal-stack-start`
- `multimodal-stack-stop`
- `multimodal-stack-restart`
- `multimodal-stack-status`
- `multimodal-stack-urls`

Testing:
- `multimodal-stack-selftest`
- `multimodal-done-check`

Invocation:
- `harp-multimodal-invoke`
- `harp-multimodal-invocations`

Artifact governance:
- `multimodal-artifact-scan`
- `multimodal-artifacts`
- `multimodal-artifact-summary`
- `multimodal-artifact-approve`
- `multimodal-artifact-deny`
- `multimodal-release-check`
- `multimodal-mark-release-ready`
- `multimodal-release-gate`

## Final Local Rule

Models may explore.  
H.A.R.P. must approve.  
Anubis must audit.  
Humans decide release.
