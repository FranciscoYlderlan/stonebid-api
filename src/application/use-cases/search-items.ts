import type { ItemCatalog, ItemSearchPage } from '../../domain/catalog/item-catalog.ts';
import type { CatalogItem } from '../../domain/entities/item.ts';
import {
  endedLotIds,
  getItemAuction,
  type ItemAuction,
} from '../../domain/entities/item-auction.ts';
import type { Lot } from '../../domain/entities/lot.ts';
import type { LotBidsReader } from '../../domain/repositories/lot-bids-reader.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

export interface SearchItemsInput {
  query: string;
  page: number;
}

export interface SearchItemsOptions {
  clock?: () => Date;
  /** Falha ao ler os lotes no banco: a busca segue, sem a situação das obras. */
  onAuctionLookupError?: (error: unknown) => void;
}

export interface SearchItemsResultItem extends CatalogItem {
  /** Situação da obra no Stonebid (RN-19); `null` se está livre para um lote novo. */
  auction: ItemAuction | null;
}

export interface SearchItemsResult extends Omit<ItemSearchPage, 'items'> {
  items: SearchItemsResultItem[];
}

/**
 * Busca do painel do leiloeiro (RF-20): a única tela que chama a API de itens (RN-13).
 * Cada item volta com a situação da obra (RN-19), lida numa consulta só para a página.
 */
export class SearchItemsUseCase {
  private readonly clock: () => Date;

  constructor(
    private readonly catalog: ItemCatalog,
    private readonly lotsRepository: LotsRepository,
    private readonly bidsReader: LotBidsReader,
    private readonly options: SearchItemsOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(input: SearchItemsInput): Promise<SearchItemsResult> {
    const page = await this.catalog.search(input.query.trim(), input.page);
    const auctions = await this.findAuctions(page.items.map((item) => item.externalId));
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        auction: auctions.get(item.externalId) ?? null,
      })),
    };
  }

  /**
   * Antes da RN-19 a busca não lia o banco. Para não piorar a disponibilidade, uma falha aqui
   * não derruba a busca: os itens voltam com `auction: null` e a criação do lote, que checa
   * de novo com a obra travada, continua sendo a garantia.
   */
  private async findAuctions(externalIds: string[]): Promise<Map<string, ItemAuction>> {
    const result = new Map<string, ItemAuction>();
    if (externalIds.length === 0) return result;

    try {
      const lots = await this.lotsRepository.listNotCanceledByExternalIds(externalIds);
      if (lots.length === 0) return result;

      const now = this.clock();
      const ended = endedLotIds(lots, now);
      const withBids =
        ended.length > 0 ? await this.bidsReader.listLotIdsWithBids(ended) : new Set<string>();

      const byItem = new Map<string, Lot[]>();
      for (const lot of lots) {
        const list = byItem.get(lot.externalId);
        if (list) list.push(lot);
        else byItem.set(lot.externalId, [lot]);
      }
      for (const [externalId, lotsOfItem] of byItem) {
        const auction = getItemAuction(lotsOfItem, now, withBids);
        if (auction) result.set(externalId, auction);
      }
      return result;
    } catch (error) {
      this.options.onAuctionLookupError?.(error);
      return new Map();
    }
  }
}
