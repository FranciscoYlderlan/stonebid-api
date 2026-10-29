import { AppError } from './app-error.ts';

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED';

  constructor(message = 'É preciso entrar para acessar este recurso.') {
    super(message);
  }
}
