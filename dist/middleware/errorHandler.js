"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const meetingStateMachine_1 = require("../state/meetingStateMachine");
function errorHandler(err, req, res, next) {
    console.error('[Vabatim Global Error Handler]:', err.message || err);
    if (err instanceof meetingStateMachine_1.InvalidStateTransitionError) {
        return res.status(400).json({
            error: 'Invalid State Transition',
            details: err.message
        });
    }
    const statusCode = err.statusCode || err.status || 500;
    return res.status(statusCode).json({
        error: err.name || 'InternalServerError',
        message: err.message || 'An unexpected server error occurred.'
    });
}
