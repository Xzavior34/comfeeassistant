# Vabatim Option A: Device/Browser Speech Recognition Architecture

This document describes the design and integration of Option A: Device/Browser Speech Recognition within Vabatim.

---

## 1. System Pipeline Overview

```
 USER PRESSES [START LISTENING] (Explicit Action)
                       │
             Microphone Activation
                       │
       Device / Browser SpeechRecognition (`en-GB`)
                       │
         Interim / Final Text Streams
                       │
            Finalized Transcript
                       │
         Canonical Transcript Normalizer
                       │
       Clinician Speaker Role Mapping (Manual)
                       │
         LLM Clinical Note Extraction (Zod Validated)
                       │
     Grounding Validator (Timestamp & Verbatim Check)
                       │
        Clinician Review & Hash Sign-Off
                       │
         PDF & DOCX Report Generation
                       │
        Secure Signed Link Delivery
```

---

## 2. Core Architectural Guarantees

1. **Listen-Only Guarantee**: Vabatim contains 0 text-to-speech / audio response components. Output is strictly text-only documentation.
2. **Deterministic Evidence Grounding**: Every extracted claim references a valid transcript `segmentId`, timestamp bounds `[startTimeMs, endTimeMs]`, and verbatim source text. Missing fields become `"Not stated"`.
3. **Clinician Speaker Role Mapping**: Speaker identity is never assumed from voice or content. Clinicians map `Speaker 1 → Therapist` and `Speaker 2 → Client` manually. Canonical evidence text remains untouched.
4. **UK English (`en-GB`) Default**: Default language is explicitly set to `en-GB`.
