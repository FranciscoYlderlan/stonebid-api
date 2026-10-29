import { AppError } from './app-error.ts';

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('E-mail ou senha inválidos.');
  }
}
