import { AppError } from './app-error.ts';

/** Comprovante inexistente ou adulterado (selo ou conferência com o lote falhou): mesma resposta. */
export class ReceiptNotFoundError extends AppError {
  readonly code = 'RECEIPT_NOT_FOUND';

  constructor() {
    super('Comprovante não encontrado.');
  }
}
