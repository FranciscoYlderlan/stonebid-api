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
const omitImage = { imageData: true } as const;

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

  async cancel(id: string, now: Date): Promise<Lot | null> {
    // Condição na própria gravação: não cancela duas vezes nem depois do fim.
    const { count } = await prisma.lot.updateMany({
      where: { id, canceledAt: null, endsAt: { gt: now } },
      data: { canceledAt: now },
    });
    if (count === 0) return null;
    return this.findById(id);
  }
}

function toLot(lot: Omit<PrismaLot, 'imageData'>): Lot {
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
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
