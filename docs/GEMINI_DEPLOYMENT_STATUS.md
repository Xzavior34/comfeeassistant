# Vabatim Gemini LLM Integration Deployment Status

This document records the SDK compatibility, model selection, schema extraction rules, and evidence grounding safeguards for the Google Gemini LLM integration in Vabatim.

---

## 1. SDK & Model Selection Verification

- **SDK Package**: `@google/generative-ai` (`v0.24.1`)
- **Target Production Model**: `gemini-1.5-pro` (Configurable via `GEMINI_MODEL` environment variable)
- **Fallback / Staging Model**: `gemini-1.5-flash`
- **Integration Class**: `GeminiLLMProvider` ([`src/providers/llm/GeminiLLMProvider.ts`](file:///c:/Users/Administrator/CrossDevice/Pixel%208%20Pro/ai%20summary/src/providers/llm/GeminiLLMProvider.ts))

---

## 2. Evidence Grounding & Non-Invention Contract

1. **Schema Validation**: Structured outputs are parsed and validated strictly against `StructuredClinicalExtractionSchema` using Zod.
2. **Missing Field Protocol**: Any clinical field not explicitly stated in the transcript evaluates strictly to `"Not stated"`.
3. **Grounding Validator**: `GroundingValidator` verifies segment IDs, timestamp bounds `[ev.startTimeMs, ev.endTimeMs]`, verbatim text alignment, and semantic term overlap (>50%).
4. **Adversarial Safety**: 10/10 adversarial hallucination attack vectors are blocked before clinician review.
