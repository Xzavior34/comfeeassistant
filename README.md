# Vabatim: AI-Powered Accessibility & Wheelchair Documentation Assistant

Vabatim is a secure, UK-focused accessibility clinical documentation assistant designed for NHS wheelchair, seating, and mobility therapists conducting physical and online client meetings.

---

## 1. Core Principles & AI Safety Rules

1. **Absolute Diarization Rule**: The LLM NEVER guesses speaker identity or performs speaker diarization. Diarization is performed upstream by speech recognition providers (`GoogleSpeechProvider`, `AzureSpeechProvider`, `MockSpeechProvider`).
2. **Absolute Non-Invention Rule**: The LLM NEVER guesses unstated clinical diagnoses, MAT findings, or action plans. Missing fields evaluate to `"Not stated"`.
3. **Deterministic Evidence Grounding**: Every extracted clinical claim must link to verifiable timestamped canonical transcript segment evidence (`segmentId`, `startTimeMs`, `endTimeMs`, `sourceText`).
4. **Human-in-the-Loop Review**: No clinical note is ever finalized automatically. An authorized clinician must inspect, edit, and cryptographically approve every report.

---

## 2. Regulatory & Compliance Notice

> [!IMPORTANT]
> **REQUIRES ORGANISATIONAL / LEGAL / DPO REVIEW**  
> Technical controls implemented in Vabatim support UK GDPR, Data Protection Act 2018, and ICO guidance. However, software implementation alone does not constitute legal certification, NHS approval, MHRA clearance, or clinical safety accreditation. The deploying organisation's DPO and Clinical Governance lead must complete formal DPIA and clinical risk assessments prior to production deployment.

---

## 3. Quick Start & Local Development Path

Vabatim includes a zero-paid-cloud development mode using mock speech, local storage, mock email, and synthetic test fixtures.

### Installation
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Typecheck & verify TypeScript
npm run typecheck

# 4. Run automated test suite
npm run test

# 5. Run AI evaluation benchmark suite
npm run eval

# 6. Start development server
npm run dev
```

The API will start on `http://localhost:3000`.

---

## 4. Subsystem Documentation Map
- [`docs/ARCHITECTURE.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/SECURITY.md)
- [`docs/PRIVACY.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/PRIVACY.md)
- [`docs/DATA_FLOW.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/DATA_FLOW.md)
- [`docs/AI_SAFETY.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/AI_SAFETY.md)
- [`docs/SPEECH_PROVIDERS.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/SPEECH_PROVIDERS.md)
- [`docs/ONLINE_MEETINGS.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/ONLINE_MEETINGS.md)
- [`docs/DEPLOYMENT.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/DEPLOYMENT.md)
- [`docs/TESTING.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/TESTING.md)
- [`docs/OPERATIONS.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/OPERATIONS.md)
- [`docs/DATA_RETENTION.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/DATA_RETENTION.md)
- [`docs/ARCHITECTURE_AUDIT.md`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/docs/ARCHITECTURE_AUDIT.md)
