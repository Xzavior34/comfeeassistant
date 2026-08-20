export type RecordingState =
  | 'IDLE'
  | 'REQUESTING_PERMISSION'
  | 'READY'
  | 'STARTING'
  | 'LISTENING'
  | 'PAUSED'
  | 'STOPPING'
  | 'PROCESSING'
  | 'COMPLETE'
  | 'ERROR';

export class RecordingStateMachine {
  private currentState: RecordingState = 'IDLE';
  private errorMessage: string | null = null;

  getState(): RecordingState {
    return this.currentState;
  }

  getErrorMessage(): string | null {
    return this.errorMessage;
  }

  requestPermission(): void {
    if (this.currentState !== 'IDLE' && this.currentState !== 'ERROR') {
      throw new Error(`Cannot request permission from state ${this.currentState}`);
    }
    this.currentState = 'REQUESTING_PERMISSION';
  }

  grantPermission(): void {
    if (this.currentState !== 'REQUESTING_PERMISSION') {
      throw new Error(`Cannot grant permission from state ${this.currentState}`);
    }
    this.currentState = 'READY';
  }

  startListening(): void {
    if (this.currentState !== 'READY' && this.currentState !== 'IDLE') {
      throw new Error(`Cannot start listening from state ${this.currentState}`);
    }
    this.currentState = 'STARTING';
    // Transition to LISTENING
    this.currentState = 'LISTENING';
  }

  pauseListening(): void {
    if (this.currentState !== 'LISTENING') {
      throw new Error(`Cannot pause listening from state ${this.currentState}`);
    }
    this.currentState = 'PAUSED';
  }

  resumeListening(): void {
    if (this.currentState !== 'PAUSED') {
      throw new Error(`Cannot resume listening from state ${this.currentState}`);
    }
    this.currentState = 'LISTENING';
  }

  stopListening(): void {
    if (this.currentState !== 'LISTENING' && this.currentState !== 'PAUSED') {
      throw new Error(`Cannot stop listening from state ${this.currentState}`);
    }
    this.currentState = 'STOPPING';
    this.currentState = 'PROCESSING';
    this.currentState = 'COMPLETE';
  }

  fail(message: string): void {
    this.currentState = 'ERROR';
    this.errorMessage = message;
  }

  reset(): void {
    this.currentState = 'IDLE';
    this.errorMessage = null;
  }
}
