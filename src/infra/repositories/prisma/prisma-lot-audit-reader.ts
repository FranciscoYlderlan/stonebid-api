import type { LotAuditReader, LotAuditSnapshot } from '../../../application/use-cases/audit-lot.ts';
import { prisma } from './prisma-client.ts';
import { isUuid, lotQuery, toLot } from './prisma-lots-repository.ts';

/**
 * Leitura da auditoria (RF-60): lote, lances, comprovante e DEBIT/CREDIT/REFUND do lote numa transação
 * `REPEATABLE READ`, para um lance que entra no meio não parecer adulteração da cabeça.
 */
export class PrismaLotAuditReader implements LotAuditReader {
  async load(lotId: string): Promise<LotAuditSnapshot | null> {
    if (!isUuid(lotId)) return null;
    const [lot, bids, receipt, movements] = await prisma.$transaction(
      [
        prisma.lot.findUnique({ where: { id: lotId }, ...lotQuery }),
        prisma.bid.findMany({
          where: { lotId },
          orderBy: { seq: 'asc' },
          select: {
            seq: true,
            bidderId: true,
            amountCents: true,
            createdAt: true,
            prevHash: true,
            hash: true,
            seal: true,
          },
        }),
        prisma.receipt.findUnique({ where: { lotId } }),
        prisma.walletMovement.findMany({
          where: { lotId, type: { in: ['DEBIT', 'CREDIT', 'REFUND'] } },
          orderBy: { seq: 'asc' },
          select: { type: true, userId: true, amountCents: true },
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    if (!lot) return null;
    const only = (type: 'DEBIT' | 'CREDIT' | 'REFUND') =>
      movements
        .filter((movement) => movement.type === type)
        .map(({ userId, amountCents }) => ({ userId, amountCents }));
    return {
      lot: toLot(lot),
      bids,
      receipt: receipt
        ? {
            publicId: receipt.publicId,
            lotId: receipt.lotId,
            winnerPseudonym: receipt.winnerPseudonym,
            amountCents: receipt.amountCents,
            settledAt: receipt.settledAt,
            bidCount: receipt.bidCount,
            finalHash: receipt.finalHash,
            seal: receipt.seal,
          }
        : null,
      debits: only('DEBIT'),
      credits: only('CREDIT'),
      refunds: only('REFUND'),
    };
  }
}
