export interface SpeechSegment {
  speakerId: string;
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  confidence: number;
}

export class DeviceBrowserSpeechService {
  private recognition: any = null;
  private isListening: boolean = false;
  private startTime: number = 0;
  private segments: SpeechSegment[] = [];

  constructor(private language: string = 'en-GB') {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.language;
    }
  }

  isSupported(): boolean {
    return !!this.recognition;
  }

  async requestMicrophonePermission(): Promise<boolean> {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop stream after permission granted
        stream.getTracks().forEach((track) => track.stop());
        return true;
      }
      return this.isSupported();
    } catch (err) {
      console.warn('Microphone permission warning:', err);
      return false;
    }
  }

  start(
    onInterim: (text: string) => void,
    onFinalSegment: (segment: SpeechSegment) => void,
    onError: (err: string) => void
  ) {
    if (!this.recognition) {
      onError('W3C SpeechRecognition API is not supported in this browser. Synthetic device speech will be used.');
      return;
    }

    this.startTime = Date.now();
    this.isListening = true;

    this.recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const confidence = result[0].confidence || 0.95;

        if (result.isFinal) {
          const now = Date.now();
          const segment: SpeechSegment = {
            speakerId: this.segments.length % 2 === 0 ? 'Speaker 1 (Therapist)' : 'Speaker 2 (Client)',
            text: transcript.trim(),
            startTimeMs: this.startTime ? now - this.startTime - 3000 : 0,
            endTimeMs: now - this.startTime,
            confidence
          };
          this.segments.push(segment);
          onFinalSegment(segment);
        } else {
          interim += transcript;
        }
      }
      onInterim(interim);
    };

    this.recognition.onerror = (event: any) => {
      onError(`Speech recognition error: ${event.error}`);
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        try {
          this.recognition.start(); // Keep continuous recognition alive
        } catch (e) {
          // Handled
        }
      }
    };

    try {
      this.recognition.start();
    } catch (err: any) {
      onError(`Failed to start recognition: ${err.message}`);
    }
  }

  stop(): SpeechSegment[] {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignored
      }
    }
    return this.segments;
  }

  getCapturedSegments(): SpeechSegment[] {
    return this.segments;
  }
}

export const deviceSpeech = new DeviceBrowserSpeechService('en-GB');
