import { AppError } from './app-error.ts';

export class ItemImageTooLargeError extends AppError {
  readonly code = 'ITEM_IMAGE_TOO_LARGE';

  constructor(maxBytes: number) {
    super(
      `A imagem do item passa do limite de ${(maxBytes / (1024 * 1024)).toFixed(1)} MB. Escolha outro item.`,
    );
  }
}
