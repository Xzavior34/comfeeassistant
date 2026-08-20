import { MeetingState } from '@prisma/client';

export class InvalidStateTransitionError extends Error {
  constructor(public fromState: MeetingState, public toState: MeetingState) {
    super(`Invalid state transition from ${fromState} to ${toState}`);
    this.name = 'InvalidStateTransitionError';
  }
}

const ALLOWED_TRANSITIONS: Record<MeetingState, MeetingState[]> = {
  [MeetingState.CREATED]: [MeetingState.CONSENT_PENDING, MeetingState.READY, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.CONSENT_PENDING]: [MeetingState.READY, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.READY]: [MeetingState.RECORDING, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.RECORDING]: [MeetingState.UPLOADING, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.UPLOADING]: [MeetingState.UPLOADED, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.UPLOADED]: [MeetingState.TRANSCRIBING, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.TRANSCRIBING]: [MeetingState.DIARIZATION_COMPLETE, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.DIARIZATION_COMPLETE]: [MeetingState.TRANSCRIPT_READY, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.TRANSCRIPT_READY]: [MeetingState.EXTRACTION_RUNNING, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.EXTRACTION_RUNNING]: [MeetingState.EXTRACTION_COMPLETE, MeetingState.VALIDATION_FAILED, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.EXTRACTION_COMPLETE]: [MeetingState.PENDING_REVIEW, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.VALIDATION_FAILED]: [MeetingState.EXTRACTION_RUNNING, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.PENDING_REVIEW]: [MeetingState.UNDER_REVIEW, MeetingState.APPROVED, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.UNDER_REVIEW]: [MeetingState.PENDING_REVIEW, MeetingState.APPROVED, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.APPROVED]: [MeetingState.DOCUMENT_GENERATING, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.DOCUMENT_GENERATING]: [MeetingState.DOCUMENT_READY, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.DOCUMENT_READY]: [MeetingState.DELIVERY_PENDING, MeetingState.DELIVERED, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.DELIVERY_PENDING]: [MeetingState.DELIVERED, MeetingState.FAILED, MeetingState.DELETED],
  [MeetingState.DELIVERED]: [MeetingState.DELETED],
  [MeetingState.FAILED]: [MeetingState.EXTRACTION_RUNNING, MeetingState.TRANSCRIBING, MeetingState.DELETED],
  [MeetingState.DELETED]: []
};

export function canTransition(currentState: MeetingState, targetState: MeetingState): boolean {
  if (currentState === targetState) return true;
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(targetState) : false;
}

export function validateStateTransition(currentState: MeetingState, targetState: MeetingState): void {
  if (!canTransition(currentState, targetState)) {
    throw new InvalidStateTransitionError(currentState, targetState);
  }
}
