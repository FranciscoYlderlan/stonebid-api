import { AppError } from './app-error.ts';

/** Mensagem do 409 quando a chave de um lance já foi usada em outro lance (outro lote ou valor). */
export const BID_KEY_REUSED_MESSAGE =
  'Esta Idempotency-Key já foi usada em outro lance. Gere uma chave nova para um lance novo.';

export class IdempotencyKeyReusedError extends AppError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor(
    message = 'Esta Idempotency-Key já foi usada com outro valor. Gere uma chave nova para outro depósito.',
  ) {
    super(message);
  }
}
