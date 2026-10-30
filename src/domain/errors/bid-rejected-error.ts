import type { BidRejection, BidRejectionCode } from '../entities/bid.ts';
import { AppError } from './app-error.ts';

/** Lance recusado por um dos motivos do RF-70 (código, mensagem em português e detalhes). */
export class BidRejectedError extends AppError {
  readonly code: BidRejectionCode;
  declare readonly details?: BidRejection['details'];

  constructor(rejection: BidRejection) {
    super(rejection.message);
    this.code = rejection.code;
    if (rejection.details) this.details = rejection.details;
  }
}
