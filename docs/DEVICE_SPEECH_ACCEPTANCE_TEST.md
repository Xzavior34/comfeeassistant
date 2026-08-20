# Vabatim Device Speech Acceptance Test Matrix

This matrix documents acceptance testing criteria for Option A: Device/Browser Speech Recognition across supported platforms and browsers.

---

## 1. Acceptance Test Matrix

| Acceptance Criteria | Target Platform / Browser | Status Classification | Evidence & Performance Notes |
| :--- | :--- | :---: | :--- |
| **1. Microphone Permission Request** | Google Chrome 120+ / Edge / Safari | **PASS** | Explicit user action required before mic access prompt |
| **2. Non-Covert Listening UI** | Web Portal & Mobile UI | **PASS** | Prominent `🔴 LISTENING` status banner during active session |
| **3. Continuous Recognition (`en-GB`)** | Chrome / Edge WebKit Engine | **PASS** | Captures extended 30-second speech streams without truncating |
| **4. Interim vs Final Result Handling** | `DeviceSpeechProvider.ts` | **PASS** | Interim text rendered in UI; only finalized text converted to canonical evidence |
| **5. Listen-Only Enforcement** | Entire System | **PASS** | 0 TTS dependencies; zero spoken AI responses generated |
| **6. Speaker Identity Neutrality** | `DeviceSpeechProvider.ts` | **PASS** | Unassigned speakers set to `speakerId = 'UNKNOWN'`; clinician performs role mapping |
| **7. Grounding Validator Verification** | `GroundingValidator.ts` | **PASS** | Grounding validator verifies verbatim text alignment and timestamp bounds |
| **8. Mobile App Compatibility** | React Native Expo App | **PARTIAL** | Native audio pipeline active; browser SpeechRecognition reports `NOT AVAILABLE` on non-web Expo builds |
| **9. UK Clinical Terminology Support** | Synthetic Seating Fixtures | **PASS** | Accurately parses seating assessment terms (`pelvic obliquity`, `scoliosis`, `pressure redistributing cushion`) |
| **10. Rapid State Transition Resilience** | `RecordingStateMachine.ts` | **PASS** | State machine handles rapid START → STOP and START → PAUSE → STOP transitions cleanly |

---

## 2. Test Status Definitions
- **PASS**: Verified passing in automated unit/integration test suite or physical browser environment.
- **PARTIAL**: Implemented for web platforms; mobile fallback relies on native recording pipeline.
- **BLOCKED**: Requires live production credentials or physical device execution.
- **NOT TESTED**: Pending live clinical pilot.
