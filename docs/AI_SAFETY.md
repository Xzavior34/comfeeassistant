# Vabatim AI Safety & Evidence Grounding Mandates

## Absolute Rules
1. **No Speaker Diarization by LLM**: The LLM is strictly prohibited from guessing who spoke. Diarization is performed upstream by specialized speech recognition models.
2. **No Unstated Inferences**: The LLM will never infer unstated diagnoses, clinical findings, or recommendations. Missing categories evaluate strictly to `"Not stated"`.
3. **Deterministic Evidence Validator**: Extracted claims are passed through a deterministic code layer (`GroundingValidator`) that verifies segment IDs, timestamp boundaries, and verbatim text alignment before human review.
4. **Human-in-the-Loop Approval**: No clinical note is ever auto-finalized. An authorized clinician must inspect, edit, and approve every note.
