import { AppError } from './app-error.ts';

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';

  constructor(message = 'Seu papel não permite esta ação.') {
    super(message);
  }
}
