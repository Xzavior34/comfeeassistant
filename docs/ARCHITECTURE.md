# Vabatim System Architecture

## Overview
Vabatim processes physical and online client assessment meetings into structured clinical documentation for UK seating and wheelchair clinicians.

## Component Flow Diagram
```
Physical / Online Meeting
       │
       ▼
Audio Capture & Quality Check (16 kHz PCM / WAV)
       │
       ▼
Speech Recognition & Diarization (SpeechProvider Interface)
       │
       ▼
Canonical Transcript Normalization (Timestamps, Speaker IDs, Overlap Detection)
       │
       ▼
Speaker-Role Mapping (Speaker 1 -> Therapist, Speaker 2 -> Client)
       │
       ▼
AI Structured Extraction (Zod Runtime Validation)
       │
       ▼
Deterministic Grounding Validator (Evidence Verification Engine)
       │
       ▼
Human-in-the-Loop Review UI (Clinician Inspection & Edits)
       │
       ▼
Clinician Cryptographic Sign-Off & Approval
       │
       ▼
Server-Side PDF / DOCX Generation (pdfkit & docx)
       │
       ▼
Secure Delivery Notification & Signed URL Access (15 min Expiration)
       │
       ▼
Tamper-Evident Audit Logging & Automated Data Retention Cleaner
```

## Status Classifications
- **IMPLEMENTED**: Monorepo core, Express API, Prisma Schema, State Machine, Mock Speech/Storage/Email Providers, Canonicalization Engine, Zod Extraction Schema, Deterministic Grounding Validator, Review API, Document Generators (PDF/DOCX), Secure URL Delivery, Audit Logger, React Native Mobile UI, Jest Test Suite, AI Evaluation Harness.
- **EXTERNAL DEPENDENCY**: Production Google Cloud Speech API credentials, Azure Speech API keys, AWS S3 buckets, Production SMTP service.
- **REQUIRES LEGAL/CLINICAL REVIEW**: UK GDPR DPIA, NHS Trust Clinical Risk Assessment, ICO privacy policy approval.
