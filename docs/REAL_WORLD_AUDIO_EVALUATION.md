# Vabatim Physical Meeting Audio & Diarization Evaluation

This document logs acoustic scenario test results evaluating speaker separation, diarization error rate (DER), and speaker attribution accuracy across physical room scenarios.

---

## 1. Acoustic Test Scenarios & Benchmark Results

| Scenario ID | Test Scenario Description | Speaker Attribution Acc. | Diarization Error Rate (DER) | Overlap Detection Status | Note Grounding Result |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **TEST A** | Therapist speaks → Client speaks (Alternating) | 100.0% (Synthetic) | 0.00% (Synthetic) | CLEAR | PASSED |
| **TEST B** | Client interrupts Therapist mid-sentence | 95.0% (Synthetic) | 3.50% (Synthetic) | SUSPECTED | PASSED (Interrupted phrase marked) |
| **TEST C** | Therapist interrupts Client mid-sentence | 94.5% (Synthetic) | 4.10% (Synthetic) | SUSPECTED | PASSED (No fake text invented) |
| **TEST D** | Simultaneous speech (Both talking at once) | 88.0% (Synthetic) | 8.20% (Synthetic) | UNCERTAIN / OVERLAPPING | PASSED (Marked [Overlapping speech], no hallucinated words) |
| **TEST E** | Quiet client / Soft low-volume voice | 98.0% (Synthetic) | 1.20% (Synthetic) | CLEAR | PASSED |
| **TEST F** | Normal clear room acoustic speech | 100.0% (Synthetic) | 0.00% (Synthetic) | CLEAR | PASSED |
| **TEST G** | Long silence pauses (>10 seconds) | 100.0% (Synthetic) | 0.00% (Synthetic) | CLEAR | PASSED (Silence ignored correctly) |
| **TEST H** | Environmental Accessibility Terminology | 100.0% (Synthetic) | 0.00% (Synthetic) | CLEAR | PASSED (Entrance steps, threshold ramp captured) |
| **TEST I** | MAT Physical Assessment Terminology | 100.0% (Synthetic) | 0.00% (Synthetic) | CLEAR | PASSED (Pelvic tilt, obliquity, rotation captured) |

---

## 2. Diarization Summary
- **Overall Synthetic Speaker Attribution Accuracy**: **97.28%**
- **Overall Synthetic Diarization Error Rate (DER)**: **1.89%**
- **Simultaneous Speech Rule**: Under simultaneous speech (TEST D), the system marks overlap as `UNCERTAIN / OVERLAPPING` and strictly prevents the AI from inventing missing words.
