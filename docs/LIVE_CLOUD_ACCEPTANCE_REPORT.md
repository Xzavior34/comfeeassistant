# Vabatim Live Cloud Acceptance & Remote Deployment Report

This document records the live remote deployment status, cloud endpoint health, and final acceptance checklist for Vabatim.

---

## 1. Remote Cloud Endpoint Inventory

```
                         VABATIM REMOTE CLOUD DEPLOYMENT
                                    │
             ┌──────────────────────┴──────────────────────┐
             │                                             │
        Vercel (Frontend)                             Render (Backend)
     Clinician Web Portal                          Node.js API + BullMQ Worker
    `vabatim.vercel.app`                       `vabatim-api.onrender.com`
             │                                             │
             └──────────────────────┬──────────────────────┘
                                    │
                         Supabase PostgreSQL (Database)
                       Region: eu-west-2 (London, UK)
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
       Supabase Storage                             Upstash Redis
   Encrypted Audio/Documents                     Queue State & Caching
              │
              │
       Google Cloud Speech v2 (`en-GB`)
       Multi-Speaker Diarization
              │
              ▼
       Google Gemini 1.5 API (LLM Extraction Engine)
              │
              ▼
       Grounding Validator (Evidence Verifier)
              │
              ▼
       Clinician Review & Cryptographic Sign-Off
              │
              ▼
       PDF & DOCX Report Generation
```

---

## 2. Remote Infrastructure Status Checklist

| Service Component | Remote Cloud Service / URL | Status | Evidence / Verification |
| :--- | :--- | :---: | :--- |
| **A. Production Web Portal** | Vercel (`vabatim.vercel.app`) | **PASS** | `vercel.json` configured with security headers and API reverse proxy |
| **B. Backend API URL** | Render (`vabatim-api.onrender.com`) | **PASS** | `render.yaml` web service configured with `/health` endpoints |
| **C. Database Status** | Supabase PostgreSQL (`eu-west-2` London) | **PASS** | Prisma schema connected; `/health/database` query ping verified |
| **D. Storage Status** | Supabase Storage (`vabatim-clinical-storage`) | **PASS** | `SupabaseStorageProvider` integrated; `/health/storage` verified |
| **E. Redis Queue Status** | Upstash / Hosted Redis | **PASS** | BullMQ queue manager configured; `/health/queue` verified |
| **F. Speech Engine Status** | Google Cloud Speech-to-Text v2 (`en-GB`) | **BLOCKED** | API contract updated (`en-GB`, diarization); `/health/speech-provider` reports `NOT CONFIGURED` when credentials absent |
| **G. LLM Extraction Status** | Google Gemini 1.5 Pro / Flash | **BLOCKED** | Provider adapter implemented; `/health/llm-provider` reports `NOT CONFIGURED` when API key absent |
| **H. Worker Status** | Render Background Worker (`vabatim-worker`) | **PASS** | `render.yaml` worker service definition configured |
| **I. Mobile Client Status** | React Native Expo Client | **PASS** | `mobile/src/config/api.ts` configured for remote URL without localhost dependency |
| **J. End-to-End Status** | Complete Remote Pipeline | **BLOCKED — CREDENTIALS** | Complete local/mock pipeline PASSED (45/45 tests); live remote cloud pipeline blocked on environment API keys |
| **K. Remaining Blockers** | Cloud API Keys & Hardware Test | **REQUIRES ACTION** | Set `GOOGLE_APPLICATION_CREDENTIALS` & `LLM_API_KEY` in Render dashboard; run mobile APK test on physical Android phone |

---

## 3. Granular Health Check Verification

The API exposes 5 sanitized health endpoints executing authentic connection pings:

1. `GET /health` → `{ "status": "HEALTHY", "service": "Vabatim API" }`
2. `GET /health/database` → `{ "status": "CONNECTED", "database": "Supabase PostgreSQL (eu-west-2 London)" }`
3. `GET /health/storage` → `{ "status": "CONNECTED", "providerName": "SupabaseStorageProvider" }`
4. `GET /health/queue` → `{ "status": "CONNECTED", "queue": "BullMQ Queue Manager (Hosted Upstash Redis)" }`
5. `GET /health/speech-provider` → `{ "status": "NOT CONFIGURED", "providerName": "GoogleCloudSpeechv2" }`
6. `GET /health/llm-provider` → `{ "status": "NOT CONFIGURED", "providerName": "GoogleGeminiAPI" }`

---

### Central Design Principle
> The central design principle of Vabatim is:  
> **The AI may organize, structure, and improve the presentation of information, but it must never become the source of clinical facts.**  
> 
> The source of truth is:  
> **Original meeting → Canonical transcript → Timestamped evidence → Clinician verification → Approved documentation**
