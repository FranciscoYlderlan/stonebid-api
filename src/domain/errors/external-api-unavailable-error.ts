import { AppError } from './app-error.ts';

export class ExternalApiUnavailableError extends AppError {
  readonly code = 'EXTERNAL_API_UNAVAILABLE';

  constructor(
    message = 'A API de itens (Art Institute of Chicago) não respondeu. Tente de novo em instantes.',
  ) {
    super(message);
  }
}
