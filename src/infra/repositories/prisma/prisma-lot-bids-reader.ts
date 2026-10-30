import type { LotBidsReader } from '../../../domain/repositories/lot-bids-reader.ts';
import { prisma } from './prisma-client.ts';
import { isUuid } from './prisma-lots-repository.ts';

/** Leitura real dos lances (RN-12, RN-19). */
export class PrismaLotBidsReader implements LotBidsReader {
  async hasBids(lotId: string): Promise<boolean> {
    if (!isUuid(lotId)) return false;
    const bid = await prisma.bid.findFirst({ where: { lotId }, select: { id: true } });
    return bid !== null;
  }

  async listLotIdsWithBids(lotIds: readonly string[]): Promise<Set<string>> {
    const ids = lotIds.filter(isUuid);
    if (ids.length === 0) return new Set();
    const rows = await prisma.bid.groupBy({ by: ['lotId'], where: { lotId: { in: ids } } });
    return new Set(rows.map((row) => row.lotId));
  }
}
