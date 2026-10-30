import type { ItemCatalog } from '../../domain/catalog/item-catalog.ts';
import { endedLotIds, getItemAuction } from '../../domain/entities/item-auction.ts';
import { MIN_LOT_DURATION_MS, START_TOLERANCE_MS, type Lot } from '../../domain/entities/lot.ts';
import { InvalidLotError } from '../../domain/errors/invalid-lot-error.ts';
import { ItemAlreadyAuctionedError } from '../../domain/errors/item-already-auctioned-error.ts';
import { ItemNotFoundError } from '../../domain/errors/item-not-found-error.ts';
import type { LotBidsReader } from '../../domain/repositories/lot-bids-reader.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

export interface CreateLotInput {
  auctioneerId: string;
  externalId: string;
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: Date;
  endsAt: Date;
}

export interface CreateLotOptions {
  imageMaxBytes: number;
  clock?: () => Date;
}

/**
 * Cria o lote (RF-21). Valida as datas pela hora do servidor (Q-07), busca o item na API
 * externa e copia dados e imagem para o banco (RN-13). Se a API falhar, nada é gravado.
 * RN-19: recusa obra com lote agendado, ao vivo ou arrematado; a checagem final roda com a
 * obra travada no repositório, então dois pedidos simultâneos não criam dois lotes.
 */
export class CreateLotUseCase {
  private readonly clock: () => Date;

  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly catalog: ItemCatalog,
    private readonly bidsReader: LotBidsReader,
    private readonly options: CreateLotOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(input: CreateLotInput): Promise<{ lot: Lot; now: Date }> {
    const now = this.clock();

    if (input.startsAt.getTime() < now.getTime() - START_TOLERANCE_MS) {
      throw new InvalidLotError('O início do lote não pode estar no passado.');
    }
    if (input.endsAt.getTime() - input.startsAt.getTime() < MIN_LOT_DURATION_MS) {
      throw new InvalidLotError('O fim do lote precisa ser pelo menos 5 minutos depois do início.');
    }

    // Recusa cedo, sem chamar a API externa nem baixar a imagem. A garantia é a checagem
    // dentro da trava, no create.
    await this.assertItemAvailable(
      await this.lotsRepository.listNotCanceledByExternalIds([input.externalId]),
    );

    const item = await this.catalog.findById(input.externalId);
    if (!item) throw new ItemNotFoundError();

    const image = await this.catalog.downloadImage(item.imageUrl, this.options.imageMaxBytes);

    const lot = await this.lotsRepository.create(
      {
        auctioneerId: input.auctioneerId,
        externalId: item.externalId,
        title: item.title,
        attributes: item.attributes,
        image,
        startingBidCents: input.startingBidCents,
        minIncrementCents: input.minIncrementCents,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
      (lotsOfItem) => this.assertItemAvailable(lotsOfItem),
    );

    return { lot, now: this.clock() };
  }

  private async assertItemAvailable(lotsOfItem: Lot[]): Promise<void> {
    if (lotsOfItem.length === 0) return;
    const now = this.clock();
    const ended = endedLotIds(lotsOfItem, now);
    // Lances de lote encerrado não mudam mais: ler fora da transação não abre corrida.
    const withBids =
      ended.length > 0 ? await this.bidsReader.listLotIdsWithBids(ended) : new Set<string>();
    const auction = getItemAuction(lotsOfItem, now, withBids);
    if (auction) throw new ItemAlreadyAuctionedError(auction);
  }
}
