import { AppError } from '../../../domain/errors/app-error.ts';

/** Segundos até o balde reabrir, arredondados para cima, como no `retry-after` do plugin. */
export function retryAfterSeconds(ttlMs: number): number {
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

/**
 * Limite de requisições estourado (429). O `retry-after` vai no cabeçalho; a mensagem diz os mesmos
 * segundos em português (o `after` do `@fastify/rate-limit` vem em inglês).
 */
export class TooManyRequestsError extends AppError {
  readonly code = 'TOO_MANY_REQUESTS';

  constructor(seconds: number) {
    const unit = seconds === 1 ? 'segundo' : 'segundos';
    super(`Muitas requisições. Tente de novo em ${seconds} ${unit}.`);
  }
}
