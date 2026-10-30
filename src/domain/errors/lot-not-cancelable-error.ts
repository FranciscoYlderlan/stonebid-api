import { AppError } from './app-error.ts';

export class LotNotCancelableError extends AppError {
  readonly code = 'LOT_NOT_CANCELABLE';
}
