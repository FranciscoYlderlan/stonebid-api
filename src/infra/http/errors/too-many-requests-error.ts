import { AppError } from '../../../domain/errors/app-error.ts';

/** Limite de requisições estourado (429). O `retry-after` vai no cabeçalho. */
export class TooManyRequestsError extends AppError {
  readonly code = 'TOO_MANY_REQUESTS';

  constructor(retryAfter: string) {
    super(`Muitas requisições. Tente de novo em ${retryAfter}.`);
  }
}
