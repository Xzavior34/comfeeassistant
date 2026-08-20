# Vabatim Device Speech Recognition Privacy & Data Protection Impact Notice

This document details the data privacy classification, audio stream handling, and UK GDPR compliance considerations for Option A: Device/Browser Speech Recognition.

---

## 1. Processing Classification: LOCAL vs REMOTE BROWSER PROCESSING

> [!CAUTION]
> **Data Flow Transparency Warning**  
> W3C Browser `SpeechRecognition` and `webkitSpeechRecognition` implementations on Google Chrome, Microsoft Edge, and Apple Safari **stream audio data to vendor cloud endpoints** (Google Cloud / Apple Speech Services) for processing.  
> **Vabatim explicitly classifies browser SpeechRecognition as `REMOTE BROWSER PROCESSING`. It must NEVER be represented to clinicians as "fully offline local device processing."**

| Platform / Engine | Underlying Speech Engine | Processing Classification | Network Connection Required? | Vendor Data Policy |
| :--- | :--- | :---: | :---: | :--- |
| **Google Chrome (Desktop/Mobile)** | Google Server-Side Speech Recognition | **REMOTE BROWSER PROCESSING** | Yes | Audio streamed to Google cloud speech servers |
| **Microsoft Edge (Desktop)** | Microsoft Azure Speech Services | **REMOTE BROWSER PROCESSING** | Yes | Audio streamed to Microsoft cloud speech servers |
| **Apple Safari (iOS/macOS)** | Apple Siri/Dictation Engine | **REMOTE BROWSER PROCESSING** | Yes (on older devices) / Local (on newer iOS/macOS devices with On-Device Dictation) | Dictation audio processed locally on Apple Silicon; otherwise streamed to Apple |
| **Android SpeechRecognizer (Native)** | Google On-Device Speech / Server | **HYBRID (Local where installed)** | Optional | Local offline model if offline speech pack installed; server fallback otherwise |

---

## 2. UK GDPR & NHS Governance Transparency

1. **Consent Record**: Before starting any recognition session, the clinician must confirm patient consent (`v1.2-UK-GDPR`).
2. **Non-Covert Overlay**: The active listening UI displays an explicit non-covert banner (`🔴 LISTENING — MICROPHONE ACTIVE`).
3. **Data Minimization**: Raw audio binaries are not stored on third-party servers when using browser dictation. Only finalized text segments are sent to Vabatim backend.
4. **Audit Trail**: Every speech session start, pause, stop, and role assignment event is logged to the SHA-256 tamper-evident audit logger.
