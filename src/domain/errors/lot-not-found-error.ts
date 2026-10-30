import { AppError } from './app-error.ts';

export class LotNotFoundError extends AppError {
  readonly code = 'LOT_NOT_FOUND';

  constructor() {
    super('Lote não encontrado.');
  }
}
