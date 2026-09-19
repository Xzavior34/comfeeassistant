"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidStateTransitionError = void 0;
exports.canTransition = canTransition;
exports.validateStateTransition = validateStateTransition;
const client_1 = require("@prisma/client");
class InvalidStateTransitionError extends Error {
    fromState;
    toState;
    constructor(fromState, toState) {
        super(`Invalid state transition from ${fromState} to ${toState}`);
        this.fromState = fromState;
        this.toState = toState;
        this.name = 'InvalidStateTransitionError';
    }
}
exports.InvalidStateTransitionError = InvalidStateTransitionError;
const ALLOWED_TRANSITIONS = {
    [client_1.MeetingState.CREATED]: [client_1.MeetingState.CONSENT_PENDING, client_1.MeetingState.READY, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.CONSENT_PENDING]: [client_1.MeetingState.READY, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.READY]: [client_1.MeetingState.RECORDING, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.RECORDING]: [client_1.MeetingState.UPLOADING, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.UPLOADING]: [client_1.MeetingState.UPLOADED, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.UPLOADED]: [client_1.MeetingState.TRANSCRIBING, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.TRANSCRIBING]: [client_1.MeetingState.DIARIZATION_COMPLETE, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.DIARIZATION_COMPLETE]: [client_1.MeetingState.TRANSCRIPT_READY, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.TRANSCRIPT_READY]: [client_1.MeetingState.EXTRACTION_RUNNING, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.EXTRACTION_RUNNING]: [client_1.MeetingState.EXTRACTION_COMPLETE, client_1.MeetingState.VALIDATION_FAILED, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.EXTRACTION_COMPLETE]: [client_1.MeetingState.PENDING_REVIEW, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.VALIDATION_FAILED]: [client_1.MeetingState.EXTRACTION_RUNNING, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.PENDING_REVIEW]: [client_1.MeetingState.UNDER_REVIEW, client_1.MeetingState.APPROVED, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.UNDER_REVIEW]: [client_1.MeetingState.PENDING_REVIEW, client_1.MeetingState.APPROVED, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.APPROVED]: [client_1.MeetingState.DOCUMENT_GENERATING, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.DOCUMENT_GENERATING]: [client_1.MeetingState.DOCUMENT_READY, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.DOCUMENT_READY]: [client_1.MeetingState.DELIVERY_PENDING, client_1.MeetingState.DELIVERED, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.DELIVERY_PENDING]: [client_1.MeetingState.DELIVERED, client_1.MeetingState.FAILED, client_1.MeetingState.DELETED],
    [client_1.MeetingState.DELIVERED]: [client_1.MeetingState.DELETED],
    [client_1.MeetingState.FAILED]: [client_1.MeetingState.EXTRACTION_RUNNING, client_1.MeetingState.TRANSCRIBING, client_1.MeetingState.DELETED],
    [client_1.MeetingState.DELETED]: []
};
function canTransition(currentState, targetState) {
    if (currentState === targetState)
        return true;
    const allowed = ALLOWED_TRANSITIONS[currentState];
    return allowed ? allowed.includes(targetState) : false;
}
function validateStateTransition(currentState, targetState) {
    if (!canTransition(currentState, targetState)) {
        throw new InvalidStateTransitionError(currentState, targetState);
    }
}
