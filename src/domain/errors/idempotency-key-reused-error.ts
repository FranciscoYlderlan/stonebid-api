import { AppError } from './app-error.ts';

export class IdempotencyKeyReusedError extends AppError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super(
      'Esta Idempotency-Key já foi usada com outro valor. Gere uma chave nova para outro depósito.',
    );
  }
}
