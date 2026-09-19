"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordingStateMachine = void 0;
class RecordingStateMachine {
    currentState = 'IDLE';
    errorMessage = null;
    getState() {
        return this.currentState;
    }
    getErrorMessage() {
        return this.errorMessage;
    }
    requestPermission() {
        if (this.currentState !== 'IDLE' && this.currentState !== 'ERROR') {
            throw new Error(`Cannot request permission from state ${this.currentState}`);
        }
        this.currentState = 'REQUESTING_PERMISSION';
    }
    grantPermission() {
        if (this.currentState !== 'REQUESTING_PERMISSION') {
            throw new Error(`Cannot grant permission from state ${this.currentState}`);
        }
        this.currentState = 'READY';
    }
    startListening() {
        if (this.currentState !== 'READY' && this.currentState !== 'IDLE') {
            throw new Error(`Cannot start listening from state ${this.currentState}`);
        }
        this.currentState = 'STARTING';
        // Transition to LISTENING
        this.currentState = 'LISTENING';
    }
    pauseListening() {
        if (this.currentState !== 'LISTENING') {
            throw new Error(`Cannot pause listening from state ${this.currentState}`);
        }
        this.currentState = 'PAUSED';
    }
    resumeListening() {
        if (this.currentState !== 'PAUSED') {
            throw new Error(`Cannot resume listening from state ${this.currentState}`);
        }
        this.currentState = 'LISTENING';
    }
    stopListening() {
        if (this.currentState !== 'LISTENING' && this.currentState !== 'PAUSED') {
            throw new Error(`Cannot stop listening from state ${this.currentState}`);
        }
        this.currentState = 'STOPPING';
        this.currentState = 'PROCESSING';
        this.currentState = 'COMPLETE';
    }
    fail(message) {
        this.currentState = 'ERROR';
        this.errorMessage = message;
    }
    reset() {
        this.currentState = 'IDLE';
        this.errorMessage = null;
    }
}
exports.RecordingStateMachine = RecordingStateMachine;
