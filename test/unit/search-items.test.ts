import { describe, expect, it, vi } from 'vitest';
import { SearchItemsUseCase } from '../../src/application/use-cases/search-items.ts';
import type { ItemCatalog } from '../../src/domain/catalog/item-catalog.ts';
import type { CatalogItem } from '../../src/domain/entities/item.ts';
import type { Lot } from '../../src/domain/entities/lot.ts';
import type { LotBidsReader } from '../../src/domain/repositories/lot-bids-reader.ts';
import type { LotsRepository } from '../../src/domain/repositories/lots-repository.ts';

const now = new Date('2026-10-30T12:00:00.000Z');

function item(externalId: string): CatalogItem {
  return {
    externalId,
    title: `Obra ${externalId}`,
    imageId: '0a000000-0000-4000-8000-000000000001',
    imageUrl: 'https://iiif.example/x',
    attributes: { artist: null, date: null, medium: null, dimensions: null, placeOfOrigin: null },
  };
}

function lot(id: string, externalId: string, startsAt: string, endsAt: string): Lot {
  return {
    id,
    externalId,
    auctioneerId: 'a',
    title: 't',
    attributes: item(externalId).attributes,
    imageContentType: 'image/png',
    startingBidCents: 100,
    minIncrementCents: 10,
    startsAt: new Date(startsAt),
    originalEndsAt: new Date(endsAt),
    endsAt: new Date(endsAt),
    canceledAt: null,
    createdAt: new Date(startsAt),
    currentBidCents: null,
    leaderId: null,
    headSeq: 0,
    headHash: null,
    headSeal: null,
  };
}

const catalog = {
  search: async () => ({ items: ['1', '2', '3'].map(item), page: 1, totalPages: 1 }),
} as unknown as ItemCatalog;

describe('SearchItemsUseCase (RF-20, RN-19)', () => {
  it('uma consulta de lotes e uma de lances para a página inteira', async () => {
    const listNotCanceledByExternalIds = vi.fn(async () => [
      lot('L1', '1', '2026-10-30T11:00:00.000Z', '2026-10-30T13:00:00.000Z'),
      lot('L2', '2', '2026-10-30T09:00:00.000Z', '2026-10-30T10:00:00.000Z'),
    ]);
    const listLotIdsWithBids = vi.fn(async () => new Set(['L2']));
    const useCase = new SearchItemsUseCase(
      catalog,
      { listNotCanceledByExternalIds } as unknown as LotsRepository,
      { listLotIdsWithBids } as unknown as LotBidsReader,
      { clock: () => now },
    );

    const result = await useCase.execute({ query: 'x', page: 1 });

    expect(result.items.map((i) => [i.externalId, i.auction])).toEqual([
      ['1', { status: 'LIVE', lotId: 'L1' }],
      ['2', { status: 'SOLD', lotId: 'L2' }],
      ['3', null],
    ]);
    expect(listNotCanceledByExternalIds).toHaveBeenCalledTimes(1);
    expect(listNotCanceledByExternalIds).toHaveBeenCalledWith(['1', '2', '3']);
    expect(listLotIdsWithBids).toHaveBeenCalledTimes(1);
    expect(listLotIdsWithBids).toHaveBeenCalledWith(['L2']);
  });

  it('banco fora: a busca segue com auction null e avisa', async () => {
    const onAuctionLookupError = vi.fn();
    const failure = new Error('banco fora');
    const useCase = new SearchItemsUseCase(
      catalog,
      {
        listNotCanceledByExternalIds: async () => {
          throw failure;
        },
      } as unknown as LotsRepository,
      {} as LotBidsReader,
      { clock: () => now, onAuctionLookupError },
    );

    const result = await useCase.execute({ query: 'x', page: 1 });

    expect(result.items.map((i) => i.auction)).toEqual([null, null, null]);
    expect(onAuctionLookupError).toHaveBeenCalledWith(failure);
  });
});
