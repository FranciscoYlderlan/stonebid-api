import type { ItemAttributes, ItemImage } from '../../../domain/entities/item.ts';
import type { Lot } from '../../../domain/entities/lot.ts';
import type {
  AssertItemAvailable,
  CreateLotInput,
  LotsRepository,
} from '../../../domain/repositories/lots-repository.ts';
import type { Lot as PrismaLot } from './generated/client.ts';
import { prisma } from './prisma-client.ts';

/** Prefixo da chave do advisory lock da obra (RN-19), para não colidir com outros locks. */
const ITEM_LOCK_PREFIX = 'stonebid:lot-item:';

/** Nunca carrega os bytes da imagem junto com o lote. */
export const omitImage = { imageData: true } as const;

export class PrismaLotsRepository implements LotsRepository {
  /**
   * RN-19, concorrência: o estado do lote deriva do relógio (RN-01), então não há coluna de
   * estado para um índice único parcial. A transação pega um advisory lock pelo id da obra
   * (`pg_advisory_xact_lock`, solto no commit/rollback): criações da mesma obra entram em fila,
   * e a segunda já enxerga o lote da primeira na checagem.
   */
  async create(data: CreateLotInput, assertItemAvailable: AssertItemAvailable): Promise<Lot> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ITEM_LOCK_PREFIX + data.externalId}, 0))`;

        const lotsOfItem = await tx.lot.findMany({
          where: { externalId: data.externalId, canceledAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          omit: omitImage,
        });
        await assertItemAvailable(lotsOfItem.map(toLot));

        const lot = await tx.lot.create({
          data: {
            auctioneerId: data.auctioneerId,
            externalId: data.externalId,
            title: data.title,
            attributes: { ...data.attributes },
            imageData: new Uint8Array(data.image.data),
            imageContentType: data.image.contentType,
            startingBidCents: data.startingBidCents,
            minIncrementCents: data.minIncrementCents,
            startsAt: data.startsAt,
            originalEndsAt: data.endsAt,
            endsAt: data.endsAt,
          },
          omit: omitImage,
        });
        return toLot(lot);
      },
      // A espera pelo lock conta no timeout: folga para a fila de pedidos da mesma obra.
      { maxWait: 10_000, timeout: 15_000 },
    );
  }

  async listNotCanceledByExternalIds(externalIds: readonly string[]): Promise<Lot[]> {
    if (externalIds.length === 0) return [];
    const lots = await prisma.lot.findMany({
      where: { externalId: { in: [...externalIds] }, canceledAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      omit: omitImage,
    });
    return lots.map(toLot);
  }

  async findById(id: string): Promise<Lot | null> {
    if (!isUuid(id)) return null;
    const lot = await prisma.lot.findUnique({ where: { id }, omit: omitImage });
    return lot ? toLot(lot) : null;
  }

  async findImage(id: string): Promise<ItemImage | null> {
    if (!isUuid(id)) return null;
    const lot = await prisma.lot.findUnique({
      where: { id },
      select: { imageData: true, imageContentType: true },
    });
    return lot ? { data: lot.imageData, contentType: lot.imageContentType } : null;
  }

  async listLive(now: Date): Promise<Lot[]> {
    const lots = await prisma.lot.findMany({
      where: { canceledAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
      omit: omitImage,
    });
    return lots.map(toLot);
  }

  async listScheduled(now: Date): Promise<Lot[]> {
    const lots = await prisma.lot.findMany({
      where: { canceledAt: null, startsAt: { gt: now } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      omit: omitImage,
    });
    return lots.map(toLot);
  }

  async listEnded(now: Date, limit: number): Promise<Lot[]> {
    const lots = await prisma.lot.findMany({
      where: { canceledAt: null, endsAt: { lte: now } },
      orderBy: [{ endsAt: 'desc' }, { id: 'asc' }],
      take: limit,
      omit: omitImage,
    });
    return lots.map(toLot);
  }

  async listByAuctioneer(auctioneerId: string): Promise<Lot[]> {
    const lots = await prisma.lot.findMany({
      where: { auctioneerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      omit: omitImage,
    });
    return lots.map(toLot);
  }

  async cancel(id: string, decide: (lot: Lot) => Date): Promise<Lot | null> {
    if (!isUuid(id)) return null;
    return prisma.$transaction(
      async (tx) => {
        // Mesma trava do lance (RN-09, M-13): lances, cancelamento e fim lidos sob ela.
        const locked = await lockLotRow(tx, id);
        if (!locked) return null;
        const lot = await tx.lot.findUniqueOrThrow({ where: { id }, omit: omitImage });
        const canceledAt = decide(toLot(lot));
        const canceled = await tx.lot.update({
          where: { id },
          data: { canceledAt },
          omit: omitImage,
        });
        return toLot(canceled);
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }
}

/** Cliente da transação interativa do Prisma. */
export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Trava a linha do lote até o fim da transação (`SELECT … FOR UPDATE`): é a serialização por lote
 * da RN-09, usada pelo lance e pelo cancelamento. `false` se o lote não existe.
 */
export async function lockLotRow(tx: PrismaTx, lotId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "lots" WHERE "id" = ${lotId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export function toLot(lot: Omit<PrismaLot, 'imageData'>): Lot {
  return {
    id: lot.id,
    auctioneerId: lot.auctioneerId,
    externalId: lot.externalId,
    title: lot.title,
    attributes: lot.attributes as unknown as ItemAttributes,
    imageContentType: lot.imageContentType,
    startingBidCents: lot.startingBidCents,
    minIncrementCents: lot.minIncrementCents,
    startsAt: lot.startsAt,
    originalEndsAt: lot.originalEndsAt,
    endsAt: lot.endsAt,
    canceledAt: lot.canceledAt,
    createdAt: lot.createdAt,
    currentBidCents: lot.currentBidCents,
    leaderId: lot.leaderId,
    headSeq: lot.headSeq,
    headHash: lot.headHash,
    headSeal: lot.headSeal,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
