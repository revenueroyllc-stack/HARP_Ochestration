# H.A.R.P. Trustline Rules

## Model Non-Rescale Rule

Models are not allowed to silently rescale.

Every model must have:
- fixed provider
- fixed model name
- fixed model version or revision
- fixed quantization where applicable
- fixed max context window
- fixed max concurrency
- fixed memory/GPU budget
- fixed fallback policy
- fixed tool permissions
- fixed risk tier

Forbidden:
- no automatic model upgrade
- no automatic model fallback
- no automatic context expansion
- no automatic extra replicas
- no automatic model downloads
- no direct model access from cockpits
- no model-owned tool credentials
- no production action from a model without H.A.R.P.

All model calls must pass through Horus Nexus and be logged by Anubis Sentinel.

## Immutable Model Containment Rule

All model workers must run as immutable API-only containers.

A model worker may:
- receive an approved API request from H.A.R.P.
- load a fixed approved model
- produce a response
- return logs or metrics to H.A.R.P.

A model worker may not:
- run privileged
- run as root
- mount the Docker socket
- mount the host filesystem
- write to model weights
- download new models
- install packages
- fine-tune itself
- mutate its own system prompt
- call tools directly
- access production secrets
- access production databases
- expose public ports
- access the internet unless explicitly approved
- spawn new containers
- change its own resource limits
- choose its own fallback model

Required controls:
- read-only root filesystem
- read-only model weights
- non-root user
- no-new-privileges
- cap_drop: ALL
- no Docker socket
- no privileged mode
- private internal network
- fixed CPU/memory/GPU limits
- fixed context length
- fixed concurrency
- pinned image digest
- H.A.R.P.-only API access
- Anubis audit logging
