# Vabatim Speech Recognition Provider Comparative Evaluation

This document compares Google Cloud Speech-to-Text v2, Azure Cognitive Services Speech SDK, and MockSpeechProvider across UK seating assessment requirements.

---

## 1. Provider Comparison Matrix

| Metric / Capability | Google Cloud Speech v2 | Azure Speech SDK | MockSpeechProvider (Local Dev) |
| :--- | :--- | :--- | :--- |
| **SDK / Contract Version** | `@google-cloud/speech` v3+ | `microsoft-cognitiveservices-speech-sdk` v1.35+ | Internal TS Mock Adapter |
| **Language Target** | `en-GB` | `en-GB` | `en-GB` |
| **Diarization Support** | `SpeakerDiarizationConfig` (min/max 2-4) | `ConversationTranscriber` (min/max 2-4) | Deterministic Multi-Speaker Diarization |
| **Medical / Clinical Model** | `medical_conversation` (US/UK preview) | Custom Speech / Medical Accent Adaptation | Synthetic UK Clinical Fixtures |
| **Word Timestamps** | Enabled (`enableWordTimeOffsets`) | Enabled (`WordLevelTimestamps`) | Enabled (Millisecond precision) |
| **Word Confidence Scores** | Enabled (`enableWordConfidence`) | Enabled (`Confidence`) | Enabled (0.90 - 0.99) |
| **Word Error Rate (WER)** | NOT MEASURED (REQUIRES PRODUCTION CLOUD CREDENTIALS) | NOT MEASURED (REQUIRES PRODUCTION CLOUD CREDENTIALS) | 0.00% (Synthetic Fixtures) |
| **Speaker Attribution Acc.** | NOT MEASURED (REQUIRES PRODUCTION CLOUD CREDENTIALS) | NOT MEASURED (REQUIRES PRODUCTION CLOUD CREDENTIALS) | 100.00% (Synthetic Fixtures) |
| **Processing Latency** | Async Batch Processing (~0.2x audio length) | Real-time Streaming & Batch Processing | Instant (~10ms) |

---

## 2. Recommendations & Next Steps
1. **Primary Provider Recommendation**: Both Google Cloud Speech v2 and Azure Speech SDK support `en-GB` multi-speaker diarization with word-level timestamps.
2. **Medical Terminology Adaptation**: Enable Custom Speech / Medical vocabulary hints (`pelvic tilt`, `pelvic obliquity`, `ischial tuberosity`, `MAT assessment`) in production recognizer configurations to minimize WER on UK clinical terms.
3. **Cloud Credential Setup**: Provision production API keys in environment variables (`GOOGLE_APPLICATION_CREDENTIALS` / `AZURE_SPEECH_KEY`) to run live WER benchmarks.
