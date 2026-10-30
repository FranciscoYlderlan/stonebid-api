import type { ItemAttributes, ItemImage } from '../entities/item.ts';
import type { Lot } from '../entities/lot.ts';

export interface CreateLotInput {
  auctioneerId: string;
  externalId: string;
  title: string;
  attributes: ItemAttributes;
  image: ItemImage;
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: Date;
  endsAt: Date;
}

export interface LotsRepository {
  create(data: CreateLotInput): Promise<Lot>;
  findById(id: string): Promise<Lot | null>;
  findImage(id: string): Promise<ItemImage | null>;
  /** Não cancelados com início ≤ agora < fim, fim mais próximo primeiro. */
  listLive(now: Date): Promise<Lot[]>;
  /** Não cancelados com agora < início, início mais próximo primeiro. */
  listScheduled(now: Date): Promise<Lot[]>;
  /** Não cancelados com fim ≤ agora, fim mais recente primeiro (até `limit`). */
  listEnded(now: Date, limit: number): Promise<Lot[]>;
  /** Todos os lotes do leiloeiro, inclusive cancelados, mais novos primeiro. */
  listByAuctioneer(auctioneerId: string): Promise<Lot[]>;
  /** Grava o cancelamento se o lote ainda não foi cancelado nem encerrou; `null` se perdeu a corrida. */
  cancel(id: string, now: Date): Promise<Lot | null>;
}
