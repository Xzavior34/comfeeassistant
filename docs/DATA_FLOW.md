# Vabatim Data Flow Architecture

## Physical Assessment Flow
1. Mobile Mic -> Audio Capture (16kHz PCM mono target) & Audio Quality Inspector
2. Audio Quality Engine -> Clipping / Silence Warning Overlay
3. Audio Binary -> SpeechProvider API (`GoogleSpeechProvider` / `AzureSpeechProvider` / `MockSpeechProvider`)
4. Speech Recognition & Diarization -> Raw Provider Transcript
5. Canonicalization Service -> `CanonicalTranscriptSegment[]`
6. Role Mapping Engine -> Participant Roles (`THERAPIST`, `CLIENT`, `CARER`)
7. AI Intelligence Layer -> Zod Runtime Validated Note Draft
8. Deterministic Grounding Validator -> Verifies segment IDs, timestamps, and source text alignment
9. Clinician Review UI -> Side-by-side verification & editing
10. Clinician Approval -> SHA-256 cryptographic hash signing
11. Server-Side Document Generator -> Encrypted PDF & DOCX rendering
12. Delivery Engine -> Short-lived signed link notification
13. Audit Logger & Retention Cleaner -> Tamper-evident hash logging & automated deletion
