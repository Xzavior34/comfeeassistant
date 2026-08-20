import { canTransition, validateStateTransition, InvalidStateTransitionError } from '../../src/state/meetingStateMachine';
import { MeetingState } from '@prisma/client';

describe('Meeting State Machine', () => {
  it('should allow valid sequential transitions', () => {
    expect(canTransition(MeetingState.CREATED, MeetingState.CONSENT_PENDING)).toBe(true);
    expect(canTransition(MeetingState.CONSENT_PENDING, MeetingState.READY)).toBe(true);
    expect(canTransition(MeetingState.READY, MeetingState.RECORDING)).toBe(true);
    expect(canTransition(MeetingState.RECORDING, MeetingState.UPLOADING)).toBe(true);
    expect(canTransition(MeetingState.UPLOADED, MeetingState.TRANSCRIBING)).toBe(true);
    expect(canTransition(MeetingState.TRANSCRIBING, MeetingState.DIARIZATION_COMPLETE)).toBe(true);
    expect(canTransition(MeetingState.APPROVED, MeetingState.DOCUMENT_GENERATING)).toBe(true);
  });

  it('should reject invalid illegal state transitions', () => {
    expect(canTransition(MeetingState.CREATED, MeetingState.APPROVED)).toBe(false);
    expect(canTransition(MeetingState.RECORDING, MeetingState.DELIVERED)).toBe(false);

    expect(() => {
      validateStateTransition(MeetingState.CREATED, MeetingState.APPROVED);
    }).toThrow(InvalidStateTransitionError);
  });
});
