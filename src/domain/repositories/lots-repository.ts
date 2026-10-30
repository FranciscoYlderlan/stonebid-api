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

/**
 * Chamado pelo repositório com a obra travada e os lotes não cancelados dela (RN-19).
 * Lança erro para recusar a criação; nada é gravado.
 */
export type AssertItemAvailable = (lotsOfItem: Lot[]) => Promise<void>;

export interface LotsRepository {
  /**
   * Cria o lote numa transação que trava a obra (`externalId`): dois pedidos para a mesma obra
   * passam um de cada vez, e `assertItemAvailable` vê os lotes já gravados antes de inserir.
   */
  create(data: CreateLotInput, assertItemAvailable: AssertItemAvailable): Promise<Lot>;
  /** Lotes não cancelados das obras, numa consulta só (situação da obra na busca, RN-19). */
  listNotCanceledByExternalIds(externalIds: readonly string[]): Promise<Lot[]>;
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
