import { SpeechProvider, TranscriptionOptions, ProviderHealthCheckResult } from './SpeechProvider';
import { ProviderTranscript } from '../../types';

// Speaker attribution is deliberately absent from this fixture. Device speech cannot
// diarise, so a fixture that carries speaker labels would let code depend on something the
// real provider never supplies.
export class MockSpeechProvider implements SpeechProvider {
  name = 'MockSpeechProvider';

  async checkHealth(): Promise<ProviderHealthCheckResult> {
    return {
      status: 'CONNECTED',
      providerName: this.name,
      details: 'Local Development Mock Provider Active'
    };
  }

  async transcribe(audioUri: string, options?: TranscriptionOptions): Promise<ProviderTranscript> {
    return {
      providerName: this.name,
      durationMs: 45000,
      segments: [
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 0,
          endTimeMs: 3500,
          text: 'Good morning, Mr. Davis. I am Dr. Sarah Jenkins. Today we are conducting your physical seating and wheelchair assessment.',
          confidence: 0.98
        },
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 3800,
          endTimeMs: 8200,
          text: 'Thank you doctor. My main concern is severe lower back pain and pressure sores on my sacrum after sitting for 2 hours in my current wheelchair.',
          confidence: 0.95
        },
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 8500,
          endTimeMs: 14000,
          text: 'I understand. Let us inspect your home environment accessibility first. Are there any physical barriers at your entrance or inside your house?',
          confidence: 0.97
        },
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 14500,
          endTimeMs: 21000,
          text: 'Yes, there are two steps at the main front door entrance with no ramp, and the doorway to the ground floor bathroom is only 680 mm wide, which is too narrow for my current chair.',
          confidence: 0.94
        },
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 21500,
          endTimeMs: 28000,
          text: 'Right. Now performing the Mechanical Assessment Tool mat exam. I observe a 15-degree posterior pelvic tilt and a 10-degree right pelvic obliquity in sitting.',
          confidence: 0.96
        },
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 28500,
          endTimeMs: 33000,
          text: 'My current cushion feels completely worn out and gives no pelvic or lateral trunk support.',
          confidence: 0.93
        },
        {
          speakerId: 'UNKNOWN',
          startTimeMs: 33500,
          endTimeMs: 44000,
          text: 'I recommend trial of a high-specification pressure redistributing contoured foam cushion with lateral pelvic supports, and referral to occupational therapy for a modular threshold ramp.',
          confidence: 0.99
        }
      ]
    };
  }
}
