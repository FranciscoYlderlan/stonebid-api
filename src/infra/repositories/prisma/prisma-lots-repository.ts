import type { ItemAttributes, ItemImage } from '../../../domain/entities/item.ts';
import type { Lot } from '../../../domain/entities/lot.ts';
import type {
  CreateLotInput,
  LotsRepository,
} from '../../../domain/repositories/lots-repository.ts';
import type { Lot as PrismaLot } from './generated/client.ts';
import { prisma } from './prisma-client.ts';

/** Nunca carrega os bytes da imagem junto com o lote. */
const omitImage = { imageData: true } as const;

export class PrismaLotsRepository implements LotsRepository {
  async create(data: CreateLotInput): Promise<Lot> {
    const lot = await prisma.lot.create({
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
