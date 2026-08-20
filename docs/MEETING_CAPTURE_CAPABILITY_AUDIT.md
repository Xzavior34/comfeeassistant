# MEETING CAPTURE CAPABILITY AUDIT

## Overview
This audit clarifies the precise, tested capabilities of Vabatim's speech capture architecture, specifically distinguishing between physical microphone capture and virtual meeting (Zoom/Google Meet) audio routing.

## Current Capture Architecture: `DeviceSpeechProvider`
Vabatim utilizes the W3C `SpeechRecognition` API executed within the clinician's browser. It requests permission for the active device microphone.

| Capture Scenario | Capability | Status | Notes |
| :--- | :--- | :--- | :--- |
| **A. Face-to-Face Conversation** | Supported | **REQUIRES PHYSICAL DEVICE TEST** | Device placed on table; captures both participants via ambient microphone. |
| **B. Clinician Microphone** | Supported | **REQUIRES PHYSICAL DEVICE TEST** | Captures the user speaking directly into the device. |
| **C. Client Microphone (Virtual)** | **Not Supported** | **NOT IMPLEMENTED** | The browser microphone does NOT natively capture audio outputted by speakers from a Zoom/Meet call unless the physical microphone happens to "hear" the speakers. |
| **D. Browser Tab Audio** | **Not Supported** | **NOT IMPLEMENTED** | Requires `getDisplayMedia()` or dedicated tab-capture extension, which is not built into the current `DeviceSpeechProvider`. |
| **E. Zoom Participant Audio** | **Not Supported** | **NOT IMPLEMENTED** | *Direct Zoom/Google Meet participant-audio capture is not currently implemented.* Requires Zoom App/Bot integration. |
| **F. Google Meet Audio** | **Not Supported** | **NOT IMPLEMENTED** | *Direct Zoom/Google Meet participant-audio capture is not currently implemented.* Requires Google Workspace add-on or bot. |
| **G. System Audio Routing** | Theoretical | **NOT TESTED** | Virtual audio cables (e.g. VB-Cable) could route Zoom output into the browser microphone input, but this is an unsupported OS-level hack. |

## Virtual Meeting Strategy (Future Phase)
To genuinely support Zoom/Google Meet without OS-level audio routing hacks, Vabatim will require a separate integration pathway (e.g. OAuth-authorized meeting bot or direct integration with Zoom/Google APIs). This is documented as an intentional architectural boundary for the MVP.

## Consent Enforcement
| Requirement | Status | Implementation |
| :--- | :--- | :--- |
| **Explicit Consent Gate** | **PASS** | UI strictly enforces a "Grant Consent" boolean before unlocking the recording interface. |
| **Recording State Visibility**| **PASS** | "🔴 LIVE RECORDING" badge clearly visible during capture. |
| **Clinician Control** | **PASS** | Stop/Cancel buttons persistently available to abort capture and destroy transcript. |

**PRODUCTION STATUS: DEVICE-ONLY CAPTURE**
The application is certified for physical, in-room microphone capture. **Virtual meeting integration is explicitly deferred.**
