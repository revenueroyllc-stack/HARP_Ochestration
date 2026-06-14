# Maxine Multimodal Routing Map

## Local Model Lanes

| Lane | Local Name | Model | Port | Role |
|---|---|---|---|---|
| Code / repo reasoning | horus-code | Qwen3.6 35B-A3B 8bit MLX | 8080 | Coding, repo reasoning, shell planning |
| Sense / multimodal input | gemma-sense | Gemma 4 12B Instruct 8bit MLX | 8081 | Image/audio/vision understanding |
| Image fast | flux-vision-fast | flux2-klein-base-4b-mlx-8bit | 8082 | Drafts, concepts, previews |
| Image quality | flux-vision-quality | flux2-dev-4-bit | 8082 | High-detail, print-quality work |
| Image max | flux-vision-max | flux2-dev-8-bit | 8082 | Maximum local image quality |
| Voice | maxine-voice | Qwen3-TTS 12Hz 1.7B Base 8bit | 8083 | Voice generation and approved voice cloning |

## Routing Rule

Maxine receives the request.  
H.A.R.P. routes the task.  
The local worker executes inside its lane.  
Anubis audits the request, output, model, and artifact path.  
Humans approve external release.

## Default Routing

- Coding, repo work, shell planning → horus-code
- Screenshot/image/audio understanding → gemma-sense
- Normal images → flux-vision-fast
- Print-quality or high-detail images → flux-vision-quality
- Maximum-quality final/master image → flux-vision-max
- Spoken output / generated voice → maxine-voice

## Governance

Sandbox generation is allowed.

External publication, sending, posting, legal/financial use, client-facing release, or impersonation-like deployment requires human approval and audit.

Models may explore. H.A.R.P. must approve. Anubis must audit. Humans decide release.
