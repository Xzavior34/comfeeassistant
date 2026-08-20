import { Request, Response, NextFunction } from 'express';
import { InvalidStateTransitionError } from '../state/meetingStateMachine';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('[Vabatim Global Error Handler]:', err.message || err);

  if (err instanceof InvalidStateTransitionError) {
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
