import { AppError } from './app-error.ts';

export class ItemNotFoundError extends AppError {
  readonly code = 'ITEM_NOT_FOUND';

  constructor() {
    super('Item não encontrado na API de itens ou sem imagem disponível.');
  }
}
