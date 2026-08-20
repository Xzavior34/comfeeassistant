# Vabatim Speech Recognition Provider Abstraction

## Architecture
Vabatim decouples the core core processing pipeline from vendor speech APIs via the `SpeechProvider` interface:

```typescript
export interface SpeechProvider {
  name: string;
  transcribe(audioUri: string, options?: TranscriptionOptions): Promise<ProviderTranscript>;
}
```

## Implemented Adapters
- `MockSpeechProvider`: Local offline development provider returning multi-speaker synthetic seating assessment transcript data.
- `GoogleSpeechProvider`: Google Cloud Speech-to-Text adapter with diarization (`EXTERNAL DEPENDENCY`).
- `AzureSpeechProvider`: Azure Cognitive Services Speech adapter with diarization (`EXTERNAL DEPENDENCY`).
