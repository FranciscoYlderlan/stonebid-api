import { AppError } from './app-error.ts';

/** Lote encerrado ou liquidado: não aceita cancelamento. */
export class LotEndedError extends AppError {
  readonly code = 'LOT_ENDED';
}
