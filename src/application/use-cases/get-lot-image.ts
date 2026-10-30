import type { ItemImage } from '../../domain/entities/item.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

/** Imagem do lote servida do banco (RN-13): nunca chama a API externa. */
export class GetLotImageUseCase {
  constructor(private readonly lotsRepository: LotsRepository) {}

  async execute(id: string): Promise<ItemImage> {
    const image = await this.lotsRepository.findImage(id);
    if (!image) throw new LotNotFoundError();
    return image;
  }
}
