import { AppError } from './app-error.ts';

/** Regra de criação do lote violada (Q-07): vira 400 VALIDATION_ERROR, como erro de zod. */
export class InvalidLotError extends AppError {
  readonly code = 'VALIDATION_ERROR';
}
