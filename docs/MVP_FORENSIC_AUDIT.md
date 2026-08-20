# Vabatim Forensic Pre-Flight Repository Audit

This document records the forensic inspection of all subsystem components, environment variables, API endpoints, database schemas, storage providers, queue engines, and security mechanisms across Vabatim.

---

## 1. Subsystem Architecture & Implementation Inventory

| Component / Subsystem | Source Code Path | Current Status | Technical Implementation Details |
| :--- | :--- | :---: | :--- |
| **Backend Web API** | `src/app.ts`, `src/index.ts` | **IMPLEMENTED** | Express 4.x application with Helmet security headers, CORS, rate limiting, and central error handling |
| **Database ORM & State Machine** | `prisma/schema.prisma`, `src/state/meetingStateMachine.ts` | **IMPLEMENTED** | 10 Prisma models; 21-state explicit transition matrix (`CREATED` → `APPROVED` → `DELIVERED` → `DELETED`) |
| **Speech Provider Abstraction** | `src/providers/speech/` | **IMPLEMENTED** | `DeviceSpeechProvider` (Option A default, W3C SpeechRecognition, `en-GB`), `GoogleSpeechProvider`, `AzureSpeechProvider`, `MockSpeechProvider` |
| **LLM Extraction Provider** | `src/providers/llm/` | **IMPLEMENTED** | `GeminiLLMProvider` (`gemini-1.5-pro` via `@google/generative-ai` SDK), `MockLLMProvider` |
| **Zod Schema Extractor** | `src/services/aiExtraction.ts` | **IMPLEMENTED** | Strict Zod runtime validation enforcing `"Not stated"` on unmentioned clinical fields |
| **Deterministic Grounding Validator** | `src/services/groundingValidator.ts` | **IMPLEMENTED** | Verifies segment IDs, timestamp bounds, verbatim text alignment, and semantic term overlap (>50%) |
| **Clinician Review & Hash Signing** | `src/routes/reviews.ts` | **IMPLEMENTED** | Side-by-side review UI, clinician draft editing, SHA-256 cryptographic note signing |
| **Document Renderer (PDF/DOCX)** | `src/services/documentGenerator.ts` | **IMPLEMENTED** | Server-side PDF (`pdfkit`) and DOCX (`docx`) report rendering |
| **Signed URL Delivery Service** | `src/services/deliveryService.ts` | **IMPLEMENTED** | 15-minute expiring signed URLs with token validation |
| **Storage Provider Abstraction** | `src/providers/storage/` | **IMPLEMENTED** | `SupabaseStorageProvider` (`vabatim-clinical-storage`), `LocalStorageProvider` |
| **Queue Manager & Worker** | `src/queues/queueManager.ts`, `src/config/redis.ts` | **IMPLEMENTED** | BullMQ queue engine (`REDIS_URL` via `rediss://`) and `@upstash/redis` REST client |
| **Tamper-Evident Audit Logger** | `src/services/auditLogger.ts` | **IMPLEMENTED** | Cryptographic SHA-256 hash chaining; raw audio and PII scrubbed from logs |
| **Mobile App (React Native/Expo)** | `mobile/App.tsx`, `mobile/src/config/api.ts` | **IMPLEMENTED** | Auth, Consent, Recording UI, Role Mapping, Side-by-side Review, Diagnostic Screen |
| **Web Portal Deployment** | `vercel.json`, `render.yaml` | **IMPLEMENTED** | Vercel Next.js web portal config and Render backend API + worker manifests |
| **Listen-Only Enforcement** | Entire Codebase | **IMPLEMENTED** | 0 TTS / text-to-speech dependencies; text-only output contract |

---

## 2. Codebase Reference Audit Results

- **`localhost` / `127.0.0.1` References**:
  - Development fallback configurations in `src/config/env.ts` and `mobile/src/config/api.ts`.
  - In production mode (`NODE_ENV=production`), client URLs resolve dynamically to `https://vabatim-api.onrender.com`.
- **`Mock` / `mock` References**:
  - Offline test fixtures in `src/providers/speech/MockSpeechProvider.ts`, `src/providers/llm/MockLLMProvider.ts`, and unit test suites.
  - In production mode (`NODE_ENV=production`), `getSpeechProvider()` and `getLLMProvider()` reject mock provider initialization.
- **`TODO` / `FIXME` References**:
  - 0 unresolved blocking `TODO` or `FIXME` comments in core production pipeline.
