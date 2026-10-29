import { AppError } from './app-error.ts';

export class EmailTakenError extends AppError {
  readonly code = 'EMAIL_TAKEN';

  constructor() {
    super('Este e-mail já está cadastrado.');
  }
}
